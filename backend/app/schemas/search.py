"""定义文献建立搜索索引的响应。"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator


# 统一定义重排方式，供请求参数和后续重排服务复用。
RerankMethod = Literal["rule", "model"]


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

    rerank_method: RerankMethod = Field(
        default="rule",
        description="混合检索后的重排方式：rule 为规则重排，model 为模型重排",
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
    # 原始召回分数保持不变，重排方式和重排分数单独记录。
    # 默认允许为空，以兼容已有接口和历史引用快照。
    rerank_method: RerankMethod | None = None
    rerank_score: float | None = Field(
        default=None,
        allow_inf_nan=False,
        description="最终排序使用的相关性分数，不表示回答正确率",
    )


class SemanticSearchResponse(BaseModel):
    """返回当前用户的语义检索结果，不生成大模型回答。"""

    question: str
    model: str
    returned_count: int
    items: list[SemanticSearchItem]
    warnings: list[str]
