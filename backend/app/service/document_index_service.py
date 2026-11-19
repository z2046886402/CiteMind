"""组织文献解析、向量化及 Elasticsearch 批量写入。"""

import logging
from datetime import datetime, timezone

from elasticsearch.helpers import streaming_bulk

from exceptions.auth import AuthError
from exceptions.document import DocumentNotFoundError
from exceptions.search import SearchIndexError
from models.knowledgebase import KnowledgeBase
from models.user import User
from schemas.document import DocumentChunkRequest
from schemas.search import DocumentIndexResponse
from service.document_embedding_service import embed_chunks
from service.document_service import chunk_document
from service.embedding_service import (
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
)
from service.search_index_service import VECTOR_FIELD, ensure_chunk_index
from utils.database import SessionLocal
from utils.es_client import create_es_client, get_chunk_index_name

logger = logging.getLogger(__name__)

# 当前接口同步执行，先限制整篇规模；更长文献后续改用后台任务。
MAX_SYNC_CHUNKS = 200


def index_document(
    user_id: int,
    document_id: int,
    options: DocumentChunkRequest,
) -> DocumentIndexResponse:
    """为当前用户的一份文献建立完整分块索引。

    Args:
        user_id: 从已验证 JWT 中取得的用户编号。
        document_id: PostgreSQL 中的真实文献编号。
        options: 文本分块参数。

    Returns:
        本次写入数量及旧分块清理数量。

    Raises:
        AuthError: 用户不存在。
        DocumentNotFoundError: 文献不存在或不属于当前用户。
        ValueError: 文献规模超过当前同步处理限制。
        EmbeddingServiceError: 向量生成失败。
        SearchIndexError: 索引配置或写入结果不符合要求。

    Notes:
        Elasticsearch 批量写入不是整篇事务，失败时可能部分已写入。
        修复故障后重新执行，可通过稳定 ID 覆盖并修复结果。
    """
    index_name = get_chunk_index_name()

    with create_es_client() as client:
        # 先检查索引，避免配置错误时仍产生远程向量调用。
        try:
            ensure_chunk_index(client, index_name)
        except ValueError as exc:
            raise SearchIndexError(
                "索引配置不兼容，请先运行初始化脚本检查"
            ) from exc

        with SessionLocal() as db:
            if db.get(User, user_id) is None:
                raise AuthError("用户不存在")

            document = chunk_document(
                db,
                user_id,
                document_id,
                options,
            )

        if document.total_chunks > MAX_SYNC_CHUNKS:
            raise ValueError(
                "当前同步建立索引最多支持 200 块，请增大分块大小"
            )

        # 向量生成期间释放数据库连接和解析阶段的共享锁。
        embedded_chunks = embed_chunks(document.chunks)
        timestamp = datetime.now(timezone.utc).isoformat()

        # 同一文献的索引写入串行执行，并与现有删除流程协调。
        with SessionLocal() as db:
            record = (
                db.query(KnowledgeBase)
                .filter(
                    KnowledgeBase.id == document_id,
                    KnowledgeBase.user_id == str(user_id),
                )
                .with_for_update()
                .first()
            )

            # 文献可能在远程模型调用期间已被删除，写入前再次确认。
            if record is None:
                raise DocumentNotFoundError("文献不存在")

            def build_actions():
                """逐条生成操作，字段必须与严格映射保持一致。"""
                for item in embedded_chunks:
                    chunk = item.chunk

                    yield {
                        "_op_type": "index",
                        "_index": index_name,
                        "_id": (
                            f"u{user_id}:d{document_id}:"
                            f"c{chunk.chunk_index}"
                        ),
                        "_source": {
                            "user_id": str(user_id),
                            "doc_id": str(document_id),
                            "docnm_kwd": document.file_name,
                            "chunk_index": chunk.chunk_index,
                            "content_with_weight": chunk.content,
                            "token_count": chunk.token_count,
                            "start_char": chunk.start_char,
                            "end_char": chunk.end_char,
                            "start_token": chunk.start_token,
                            "end_token": chunk.end_token,
                            "chunk_size": options.chunk_size,
                            "chunk_overlap": options.chunk_overlap,
                            "tokenizer": document.tokenizer,
                            "embedding_model": EMBEDDING_MODEL,
                            "created_at": timestamp,
                            VECTOR_FIELD: item.vector,
                        },
                    }

            succeeded = 0
            failed = 0

            for ok, information in streaming_bulk(
                client,
                build_actions(),
                chunk_size=50,
                max_chunk_bytes=5 * 1024 * 1024,
                raise_on_error=False,
                raise_on_exception=True,
                max_retries=0,
            ):
                if ok:
                    succeeded += 1
                else:
                    failed += 1
                    operation = next(iter(information.values()))

                    # 不记录完整失败对象，其中可能包含文献正文和向量。
                    logger.error(
                        "分块写入失败，document_id=%s，status=%s",
                        document_id,
                        operation.get("status"),
                    )

            if failed or succeeded != document.total_chunks:
                raise SearchIndexError(
                    "分块未全部写入，可能已有部分成功，请排查后重新建立索引"
                )

            # 确保本轮写入对后续查询和数量检查可见。
            client.indices.refresh(index=index_name)

            document_filter = [
                {"term": {"user_id": str(user_id)}},
                {"term": {"doc_id": str(document_id)}},
            ]

            # 新分块全部写入成功后，才清理数量减少时遗留的尾部分块。
            cleanup = client.delete_by_query(
                index=index_name,
                query={
                    "bool": {
                        "filter": [
                            *document_filter,
                            {
                                "range": {
                                    "chunk_index": {
                                        "gt": document.total_chunks,
                                    }
                                }
                            },
                        ]
                    }
                },
                refresh=True,
                conflicts="abort",
            )

            if (
                cleanup.get("timed_out")
                or cleanup.get("failures")
                or cleanup.get("version_conflicts", 0)
            ):
                raise SearchIndexError(
                    "新分块已写入，但旧分块清理未完成，请重新建立索引"
                )

            actual_count = client.count(
                index=index_name,
                query={"bool": {"filter": document_filter}},
            )["count"]

            if actual_count != document.total_chunks:
                raise SearchIndexError(
                    "索引分块数量检查不一致，请重新建立索引"
                )

            removed_count = cleanup.get("deleted", 0)

    logger.info(
        "文献索引完成，user_id=%s，document_id=%s，chunks=%s，removed=%s",
        user_id,
        document_id,
        succeeded,
        removed_count,
    )

    return DocumentIndexResponse(
        document_id=document_id,
        file_name=document.file_name,
        index_name=index_name,
        model=EMBEDDING_MODEL,
        dimensions=EMBEDDING_DIMENSIONS,
        indexed_chunks=succeeded,
        removed_old_chunks=removed_count,
        warnings=document.warnings,
    )