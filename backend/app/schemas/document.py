"""定义知识库文献接口的响应结构。"""

from pydantic import BaseModel
from datetime import datetime

from typing import Self

from pydantic import Field, model_validator

class DocumentUploadData(BaseModel):
    """描述上传成功的文献，不暴露服务器本机存储路径。"""

    file_id: str
    file_name: str
    file_size: int


class DocumentUploadResponse(BaseModel):
    """提供与原项目风格一致的上传结果。"""

    status: str
    message: str
    data: DocumentUploadData


class DocumentListItem(BaseModel):
    """描述知识库列表中的单条文献记录。

    不返回服务器存储路径，所属用户由后端认证上下文确定。
    """

    id: int
    file_name: str
    created_at: datetime
    updated_at: datetime


class DocumentParseResponse(BaseModel):
    """描述一次同步文本提取的结果。

    page_count 仅对 PDF 有意义。
    warnings 用于说明部分页面没有文字等提取限制。
    """

    document_id: int
    file_name: str
    content: str
    character_count: int
    page_count: int | None = None
    warnings: list[str]

class DocumentChunkRequest(BaseModel):
    """定义 Token 窗口分块参数。"""

    chunk_size: int = Field(
        default=512,
        ge=64,
        le=2048,
        description="每块覆盖的原文 Token 数上限",
    )
    chunk_overlap: int = Field(
        default=64,
        ge=0,
        description="相邻块的目标重叠 Token 数",
    )

    @model_validator(mode="after")
    def validate_overlap(self) -> Self:
        """限制重叠比例，避免产生大量高度重复的分块。"""
        if self.chunk_overlap > self.chunk_size // 2:
            raise ValueError("重叠 Token 数不能超过分块大小的一半")
        return self


class DocumentChunkItem(BaseModel):
    """描述一段文本及其在解析后全文中的位置。

    字符和 Token 范围均从 0 开始，结束位置不包含在范围内。
    token_count 是原文 Token 流的覆盖数量，独立重新编码可能有差异。
    """

    chunk_index: int
    content: str
    character_count: int
    token_count: int
    start_char: int
    end_char: int
    start_token: int
    end_token: int


class DocumentChunkResponse(BaseModel):
    """返回文献分块结果及所采用的参数。"""

    document_id: int
    file_name: str
    tokenizer: str
    chunk_size: int
    chunk_overlap: int
    total_chunks: int
    chunks: list[DocumentChunkItem]
    warnings: list[str]