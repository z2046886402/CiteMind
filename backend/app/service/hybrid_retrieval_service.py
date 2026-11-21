"""在当前用户范围内执行正文关键词与向量加权混合检索。"""

import logging
from typing import Any

from exceptions.auth import AuthError
from exceptions.search import SearchIndexError
from models.knowledgebase import KnowledgeBase
from models.user import User
from schemas.search import (
    SemanticSearchItem,
    SemanticSearchRequest,
    SemanticSearchResponse,
)
from service.embedding_service import EMBEDDING_MODEL, generate_embeddings
from service.search_index_service import VECTOR_FIELD, ensure_chunk_index
from utils.database import SessionLocal
from utils.es_client import create_es_client, get_chunk_index_name

logger = logging.getLogger(__name__)


def _require_complete(response: Any) -> None:
    """拒绝超时、分片失败及提前终止的检索结果。"""
    if (
        response.get("timed_out")
        or response.get("terminated_early")
        or response.get("_shards", {}).get("failed", 0)
    ):
        raise SearchIndexError("检索未完整完成，请稍后重试")


def hybrid_search(
    user_id: int,
    options: SemanticSearchRequest,
) -> SemanticSearchResponse:
    """融合正文关键词和向量检索，并复核文献归属。

    Args:
        user_id: 已验证的用户编号。
        options: 问题、最多返回条数和最终结果的最低余弦相似度。

    Returns:
        按混合分数降序排列的片段，最多 top_k 条。

    Raises:
        AuthError: 用户不存在。
        EmbeddingServiceError: 问题向量生成失败。
        SearchIndexError: 映射不兼容或检索未完整完成。

    Notes:
        沿用原项目初始权重：关键词 0.05、向量 0.95。
        BM25 与向量分数量纲不同，权重不是实际贡献百分比。
        两个分支均限制用户和模型，返回前再次核对数据库归属。
        score 是融合排序分数；cosine_similarity 单独计算。
        最低余弦相似度作用于两个分支的最终候选。
        候选集有限，过滤后可能不足 top_k，不保证全局精确召回。
        不记录问题、正文或向量，远程请求期间不持有数据库连接。
    """
    with SessionLocal() as db:
        if db.get(User, user_id) is None:
            raise AuthError("用户不存在")

    index_name = get_chunk_index_name()
    hits = []
    cosine_by_id: dict[str, float] = {}

    with create_es_client() as client:
        if not client.indices.exists(index=index_name):
            return SemanticSearchResponse(
                question=options.question,
                model=EMBEDDING_MODEL,
                returned_count=0,
                items=[],
                warnings=["尚未建立文献搜索索引"],
            )

        try:
            ensure_chunk_index(client, index_name)
        except ValueError as exc:
            raise SearchIndexError(
                "索引配置不兼容，请检查模型和向量维度"
            ) from exc

        scope_filter = {
            "bool": {
                "filter": [
                    {"term": {"user_id": str(user_id)}},
                    {"term": {"embedding_model": EMBEDDING_MODEL}},
                    {"exists": {"field": VECTOR_FIELD}},
                ]
            }
        }

        available_count = client.count(
            index=index_name,
            query=scope_filter,
        )["count"]

        if available_count == 0:
            return SemanticSearchResponse(
                question=options.question,
                model=EMBEDDING_MODEL,
                returned_count=0,
                items=[],
                warnings=["当前用户暂无可检索分块，请先为文献建立索引"],
            )

        # 使用与文献相同的向量服务，保证模型及维度一致。
        question_vector = generate_embeddings([options.question])[0]

        # 多取少量候选，给后续过滤已删除文献留出空间。
        candidate_k = max(options.top_k * 3, 20)

        response = client.search(
            index=index_name,
            size=candidate_k,
            query={
                "bool": {
                    "filter": [scope_filter],
                    "must": [{
                        "match": {
                            "content_with_weight": {
                                "query": options.question,
                                "operator": "or",
                                "boost": 0.05,
                            }
                        }
                    }],
                }
            },
            knn={
                "field": VECTOR_FIELD,
                "boost": 0.95,
                "query_vector": question_vector,
                "k": candidate_k,
                "num_candidates": max(100, candidate_k * 5),
                "filter": scope_filter,
                "similarity": options.min_similarity,
            },
            source=[
                "doc_id",
                "chunk_index",
                "content_with_weight",
                "start_char",
                "end_char",
            ],
            allow_partial_search_results=False,
        )

        _require_complete(response)

        hits = response["hits"]["hits"]

        if hits:
            # 只对有限候选计算独立余弦值，避免返回完整向量。
            # 融合分数不能通过 2 * score - 1 还原相似度。
            scored = client.search(
                index=index_name,
                size=len(hits),
                source=False,
                query={
                    "script_score": {
                        "query": {
                            "bool": {
                                "filter": [
                                    scope_filter,
                                    {"ids": {"values": [hit["_id"] for hit in hits]}},
                                ]
                            }
                        },
                        "script": {
                            "source": (
                                "Math.max(0.0, cosineSimilarity(params.vector, '"
                                + VECTOR_FIELD
                                + "') + 1.0)"
                            ),
                            "params": {"vector": question_vector},
                        },
                    }
                },
                allow_partial_search_results=False,
            )
            _require_complete(scored)
            cosine_by_id = {
                hit["_id"]: max(-1.0, min(1.0, float(hit["_score"]) - 1.0))
                for hit in scored["hits"]["hits"]
            }

    # 远程调用结束后重新查询数据库，过滤历史残留或已删除文献。
    candidate_ids = {
        int(hit["_source"]["doc_id"])
        for hit in hits
    }

    with SessionLocal() as db:
        if db.get(User, user_id) is None:
            raise AuthError("用户不存在")

        records = (
            db.query(KnowledgeBase.id, KnowledgeBase.file_name)
            .filter(
                KnowledgeBase.user_id == str(user_id),
                KnowledgeBase.id.in_(candidate_ids),
            )
            .all()
        )

        file_names = {
            record.id: record.file_name
            for record in records
        }

    items: list[SemanticSearchItem] = []

    for hit in hits:
        source = hit["_source"]
        document_id = int(source["doc_id"])

        if document_id not in file_names:
            continue

        cosine = cosine_by_id.get(hit["_id"])
        if cosine is None or cosine < options.min_similarity:
            continue

        score = float(hit["_score"])

        items.append(
            SemanticSearchItem(
                document_id=document_id,
                file_name=file_names[document_id],
                chunk_index=source["chunk_index"],
                content=source["content_with_weight"],
                start_char=source["start_char"],
                end_char=source["end_char"],
                score=score,
                cosine_similarity=cosine,
            )
        )

        if len(items) >= options.top_k:
            break

    logger.info(
        "混合检索完成，user_id=%s，candidates=%s，returned=%s",
        user_id,
        len(hits),
        len(items),
    )

    return SemanticSearchResponse(
        question=options.question,
        model=EMBEDDING_MODEL,
        returned_count=len(items),
        items=items,
        warnings=[] if items else ["未找到可用的相关文献片段"],
    )