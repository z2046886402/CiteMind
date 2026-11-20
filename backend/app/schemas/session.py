"""定义会话创建、详情及分页列表的数据结构。"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SessionCreateRequest(BaseModel):
    """创建会话时允许客户端指定的字段。"""

    session_name: str = Field(
        default="新会话",
        min_length=1,
        max_length=255,
    )

    @field_validator("session_name")
    @classmethod
    def validate_session_name(cls, value: str) -> str:
        """去除首尾空白，拒绝只有空白的名称。"""
        name = value.strip()

        if not name:
            raise ValueError("会话名称不能为空")

        return name


class SessionResponse(BaseModel):
    """描述当前用户拥有的一份会话。"""

    model_config = ConfigDict(from_attributes=True)

    session_id: str
    session_name: str
    user_id: int
    created_at: datetime
    updated_at: datetime


class SessionCreateResponse(SessionResponse):
    """沿用原项目成功状态及会话编号的返回形式。"""

    status: Literal["success"] = "success"
    message: str = "会话创建成功"


class SessionListResponse(BaseModel):
    """描述当前用户的分页会话列表。"""

    user_id: int
    total: int
    page: int
    page_size: int
    sessions: list[SessionResponse]

class SessionRenameRequest(SessionCreateRequest):
    """复用名称校验，但重命名时必须明确提交名称。"""

    session_name: str = Field(
        ...,
        min_length=1,
        max_length=255,
    )


class SessionDeleteResponse(BaseModel):
    """描述已提交的会话删除结果。"""

    status: Literal["success"] = "success"
    message: str = "会话及所属消息已删除"
    session_id: str
    deleted_messages: int