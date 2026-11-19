"""组织文献分块与向量服务，维护文本和向量的一一对应关系。"""

import logging
from dataclasses import dataclass

from exceptions.auth import AuthError
from exceptions.embedding import EmbeddingServiceError
from models.user import User
from schemas.document import DocumentChunkItem
from schemas.embedding import (
    ChunkEmbeddingSummary,
    DocumentEmbeddingRequest,
    DocumentEmbeddingResponse,
)
from service.document_service import chunk_document
from service.embedding_service import (
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    generate_embeddings,
)
from utils.database import SessionLocal

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class EmbeddedChunk:
    """绑定原始分块和完整向量，供后续索引写入复用。"""

    chunk: DocumentChunkItem
    vector: list[float]


def embed_chunks(chunks: list[DocumentChunkItem]) -> list[EmbeddedChunk]:
    """为给定分块生成向量，并保持输入顺序。

    Args:
        chunks: 已完成文本提取和切分的分块列表。

    Returns:
        与输入顺序一致的分块及其完整向量。

    Raises:
        ValueError: 分块列表为空或某块没有有效文字。
        EmbeddingServiceError: 模型调用失败或向量数量不匹配。
    """
    if not chunks:
        raise ValueError("待向量化分块不能为空")

    for chunk in chunks:
        if not chunk.content.strip():
            raise ValueError(f"第 {chunk.chunk_index} 块没有有效文字")

    # 底层服务负责按每批 10 条请求，并校验顺序、维度和数值。
    vectors = generate_embeddings([chunk.content for chunk in chunks])

    if len(vectors) != len(chunks):
        raise EmbeddingServiceError("向量数量与分块数量不一致")

    # 禁止使用可能静默丢弃尾部数据的普通 zip。
    return [
        EmbeddedChunk(chunk=chunk, vector=vector)
        for chunk, vector in zip(chunks, vectors, strict=True)
    ]


def preview_document_embeddings(
    user_id: int,
    document_id: int,
    options: DocumentEmbeddingRequest,
) -> DocumentEmbeddingResponse:
    """抽样生成当前用户文献的分块向量，并返回检查摘要。

    Args:
        user_id: 从已验证 JWT 中取得的用户编号。
        document_id: 数据库中的真实文献编号。
        options: 分块参数及本次抽样数量。

    Returns:
        本次处理数量、模型信息及各块向量摘要。

    Raises:
        AuthError: 当前用户已不存在。
        DocumentNotFoundError: 文献不存在或不属于当前用户。
        DocumentParseError: 文件无法解析。
        EmbeddingServiceError: 向量服务调用或结果校验失败。

    Notes:
        数据读取使用独立会话，远程调用前释放连接和解析共享锁。
        返回结果对应读取时的文献快照，不作为持久索引写入凭证。
    """
    with SessionLocal() as db:
        if db.get(User, user_id) is None:
            raise AuthError("用户不存在")

        document = chunk_document(
            db=db,
            user_id=user_id,
            document_id=document_id,
            options=options,
        )

    # 网络调用可能较慢，不在等待期间持有数据库会话和文献行锁。
    selected_chunks = document.chunks[:options.sample_limit]
    embedded_chunks = embed_chunks(selected_chunks)

    summaries = [
        ChunkEmbeddingSummary(
            chunk_index=item.chunk.chunk_index,
            start_char=item.chunk.start_char,
            end_char=item.chunk.end_char,
            token_count=item.chunk.token_count,
            content_preview=item.chunk.content[:100],
            dimensions=len(item.vector),
            vector_preview=item.vector[:5],
        )
        for item in embedded_chunks
    ]

    logger.info(
        "文献向量化验证完成，user_id=%s，document_id=%s，processed=%s，total=%s",
        user_id,
        document_id,
        len(embedded_chunks),
        document.total_chunks,
    )

    return DocumentEmbeddingResponse(
        document_id=document_id,
        file_name=document.file_name,
        model=EMBEDDING_MODEL,
        dimensions=EMBEDDING_DIMENSIONS,
        chunk_size=options.chunk_size,
        chunk_overlap=options.chunk_overlap,
        total_chunks=document.total_chunks,
        processed_chunks=len(embedded_chunks),
        has_more=len(embedded_chunks) < document.total_chunks,
        items=summaries,
        warnings=document.warnings,
    )