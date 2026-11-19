"""定义文献分块向量化的验证请求和响应。"""

from pydantic import BaseModel, Field

from schemas.document import DocumentChunkRequest


class DocumentEmbeddingRequest(DocumentChunkRequest):
    """复用分块参数，并限制本次远程调用的分块数量。"""

    sample_limit: int = Field(
        default=3,
        ge=1,
        le=20,
        description="仅向量化前多少块，最多 20 块",
    )


class ChunkEmbeddingSummary(BaseModel):
    """返回向量摘要，避免向客户端传输完整向量数组。"""

    chunk_index: int
    start_char: int
    end_char: int
    token_count: int
    content_preview: str
    dimensions: int
    vector_preview: list[float]


class DocumentEmbeddingResponse(BaseModel):
    """描述一次文献分块向量化验证的结果。"""

    document_id: int
    file_name: str
    model: str
    dimensions: int
    chunk_size: int
    chunk_overlap: int
    total_chunks: int
    processed_chunks: int
    has_more: bool
    items: list[ChunkEmbeddingSummary]
    warnings: list[str]