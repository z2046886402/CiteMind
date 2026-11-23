"""定义用户会话模型。"""

import secrets

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.sql import func

from models.base import Base

from sqlalchemy import Boolean


class ChatSession(Base):
    """保存会话名称、所属用户及时间信息。

    使用 ChatSession 类名，避免与 SQLAlchemy 的 Session 类型混淆。
    会话编号沿用原项目的 16 位字符串结构。
    """

    __tablename__ = "sessions"

    __table_args__ = (
        Index(
            "ix_sessions_user_updated",
            "user_id",
            "updated_at",
        ),
    )

    session_id = Column(
        String(16),
        primary_key=True,
        default=lambda: secrets.token_hex(8),
        comment="会话唯一编号",
    )

    session_name = Column(
        String(255),
        nullable=False,
        default="新会话",
        comment="会话展示名称",
    )

    # 独立的数据库字段，与 session_name 保持同一级缩进。
    auto_title_pending = Column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
        comment="是否等待首条问答自动生成标题",
    )

    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        comment="会话所属用户编号",
    )

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="会话创建时间",
    )

    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="会话最近更新时间",
    )
