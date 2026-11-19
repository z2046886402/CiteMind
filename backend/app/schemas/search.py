"""定义文献建立搜索索引的响应。"""

from pydantic import BaseModel
from pydantic import Field, field_validator

class DocumentIndexResponse(BaseModel):
    """描述一次完整文献索引操作的结果。"""

    document_id: int
    file_name: str
    index_name: str
    model: str
    dimensions: int
    indexed_chunks: int
    removed_old_chunks: int
    warnings: list[str]

class SemanticSearchRequest(BaseModel):
    """定义单次语义检索参数。"""

    question: str = Field(
        min_length=1,
        max_length=1000,
        description="待检索的问题",
    )
    top_k: int = Field(
        default=5,
        ge=1,
        le=20,
        description="最多返回多少个相关片段",
    )
    min_similarity: float = Field(
        default=0.0,
        ge=-1.0,
        le=1.0,
        description="最低余弦相似度，不是回答正确率",
    )

    @field_validator("question")
    @classmethod
    def validate_question(cls, value: str) -> str:
        """去除首尾空白，并拒绝只有空白的输入。"""
        question = value.strip()

        if not question:
            raise ValueError("问题不能为空")

        return question


class SemanticSearchItem(BaseModel):
    """描述检索到的文献片段及来源位置。"""

    document_id: int
    file_name: str
    chunk_index: int
    content: str
    start_char: int
    end_char: int
    score: float
    cosine_similarity: float


class SemanticSearchResponse(BaseModel):
    """返回当前用户的语义检索结果，不生成大模型回答。"""

    question: str
    model: str
    returned_count: int
    items: list[SemanticSearchItem]
    warnings: list[str]