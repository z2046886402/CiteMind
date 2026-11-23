"""定义单轮文献问答的请求、引用及响应结构。"""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

from schemas.search import SemanticSearchItem, SemanticSearchRequest

from datetime import datetime
from uuid import UUID

# 推荐问题采用单行文本，限制长度，避免异常输出直接进入页面。
RecommendedQuestion = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=2,
        max_length=160,
        pattern=r"^[^\r\n]+$",
    ),
]


class RecommendedQuestionsPayload(BaseModel):
    """校验推荐问题模型返回的 JSON 数据。"""

    recommended_questions: list[RecommendedQuestion] = Field(
        min_length=1,
        max_length=3,
    )


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
    # 关联会话并保存成功后填写；临时单轮问答时为空。
    session_id: str | None = None
    message_id: UUID | None = None
    message_no: int | None = None
    created_at: datetime | None = None
    # 本次请求的调试信息，当前不持久化到消息表。
    retrieval_question: str | None = None
    history_turns: int | None = None
    # 默认空列表，兼容没有推荐问题的回答和旧消息。
    recommended_questions: list[RecommendedQuestion] = Field(
        default_factory=list,
        max_length=3,
    )
