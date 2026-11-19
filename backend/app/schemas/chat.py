"""定义单轮文献问答的请求、引用及响应结构。"""

from typing import Literal

from pydantic import BaseModel, Field

from schemas.search import SemanticSearchItem, SemanticSearchRequest


class DocumentChatRequest(SemanticSearchRequest):
    """复用检索参数，并限制单次回答使用的候选片段数。"""

    top_k: int = Field(default=5, ge=1, le=8)


class AnswerReference(SemanticSearchItem):
    """记录实际提供给回答模型的参考片段及其引用编号。"""

    citation_id: int


class DocumentChatResponse(BaseModel):
    """返回回答、引用来源及处理状态。

    generated 仅表示模型生成完成，不代表事实已经自动核验。
    """

    status: Literal[
        "generated",
        "no_evidence",
        "insufficient_evidence",
    ]
    question: str
    answer: str
    model: str | None
    references: list[AnswerReference]
    used_citation_ids: list[int]
    warnings: list[str]