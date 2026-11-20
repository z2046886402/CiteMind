"""定义会话历史消息及分页响应。"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from schemas.chat import DocumentChatResponse


class MessageResponse(DocumentChatResponse):
    """复用问答响应字段，并要求历史消息具有完整保存信息。"""

    session_id: str = Field(...)
    message_id: UUID = Field(...)
    message_no: int = Field(..., ge=1)
    created_at: datetime = Field(...)
    updated_at: datetime


class MessageListResponse(BaseModel):
    """按会话内消息序号升序返回分页历史。"""

    session_id: str
    total: int
    page: int
    page_size: int
    messages: list[MessageResponse]