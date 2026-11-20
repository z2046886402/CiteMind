"""定义多轮对话上下文及问题改写结果。"""

from pydantic import BaseModel, ConfigDict, Field


class ConversationTurn(BaseModel):
    """提供给模型的一轮历史摘要，不携带旧引用编号。"""

    message_no: int
    question: str
    answer: str
    status: str
    source_titles: list[str]


class QuestionRewrite(BaseModel):
    """描述追问消歧结果，不包含生成式答案。"""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=1000)
    needs_clarification: bool = Field(strict=True)