"""检索当前用户知识库中与问题语义相关的文献片段。"""

import logging

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


def semantic_search(
    user_id: int,
    options: SemanticSearchRequest,
) -> SemanticSearchResponse:
    """检索用户文献，并过滤已失效的数据库记录。

    Args:
        user_id: 从已验证 JWT 中取得的用户编号。
        options: 问题、返回数量及最低相似度。

    Returns:
        最多 top_k 个相关片段，没有匹配内容时返回空列表。

    Raises:
        AuthError: 用户不存在。
        EmbeddingServiceError: 问题向量生成失败。
        SearchIndexError: 索引配置不兼容或检索未完整完成。

    Notes:
        kNN 是近似检索，分数表示向量相似程度，不是事实可信度。
        不记录问题原文、片段正文或完整向量。
    """
    with SessionLocal() as db:
        if db.get(User, user_id) is None:
            raise AuthError("用户不存在")

    index_name = get_chunk_index_name()
    hits = []

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
            knn={
                "field": VECTOR_FIELD,
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
                "page_numbers",
                "contains_table",
            ],
            allow_partial_search_results=False,
        )

        if (
            response.get("timed_out")
            or response.get("_shards", {}).get("failed", 0)
        ):
            raise SearchIndexError("检索未完整完成，请稍后重试")

        hits = response["hits"]["hits"]

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

        score = float(hit["_score"])

        items.append(
            SemanticSearchItem(
                document_id=document_id,
                file_name=file_names[document_id],
                chunk_index=source["chunk_index"],
                content=source["content_with_weight"],
                start_char=source["start_char"],
                end_char=source["end_char"],
                # 兼容尚未重新建立索引的历史分块。
                page_numbers=source.get("page_numbers", []),
                contains_table=source.get("contains_table"),
                score=score,
                cosine_similarity=max(
                    -1.0,
                    min(1.0, 2 * score - 1),
                ),
            )
        )

        if len(items) >= options.top_k:
            break

    logger.info(
        "语义检索完成，user_id=%s，candidates=%s，returned=%s",
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
