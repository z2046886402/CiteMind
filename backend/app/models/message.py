"""定义会话中的问答记录及引用快照。"""

import uuid

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.sql import func

from models.base import Base


class Message(Base):
    """保存一次完整问答，而不是分别保存用户和助手两行消息。

    引用保存为回答时的文本快照，不通过外键绑定原文献。
    后续查看历史时，不需要重新检索或重新调用模型。
    """

    __tablename__ = "messages"

    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "message_no",
            name="uq_messages_session_number",
        ),
        CheckConstraint(
            "message_no > 0",
            name="ck_messages_number_positive",
        ),
        CheckConstraint(
            "status IN "
            "('generated', 'no_evidence', 'insufficient_evidence')",
            name="ck_messages_status",
        ),
    )

    message_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        comment="问答记录唯一编号",
    )

    session_id = Column(
        String(16),
        ForeignKey("sessions.session_id", ondelete="CASCADE"),
        nullable=False,
        comment="所属会话编号",
    )

    # 后续保存时，在会话行锁保护下分配，保证会话内排序明确。
    message_no = Column(
        Integer,
        nullable=False,
        comment="会话内从 1 开始递增的问答序号",
    )

    user_question = Column(
        Text,
        nullable=False,
        comment="用户问题",
    )

    model_answer = Column(
        Text,
        nullable=False,
        comment="返回给用户的完整回答",
    )

    status = Column(
        String(32),
        nullable=False,
        comment="问答结果状态",
    )

    model = Column(
        String(255),
        nullable=True,
        comment="实际回答模型；未调用回答模型时为空",
    )

    documents = Column(
        JSONB,
        nullable=False,
        default=list,
        comment="引用来源及文本快照",
    )

    used_citation_ids = Column(
        JSONB,
        nullable=False,
        default=list,
        comment="回答实际使用的引用编号",
    )

    warnings = Column(
        JSONB,
        nullable=False,
        default=list,
        comment="本次问答的提示信息",
    )
    recommended_questions = Column(
        JSONB,
        nullable=False,
        default=list,
        server_default="[]",
        comment="本次回答对应的推荐追问",
    )
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="问答记录创建时间",
    )

    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="问答记录最近更新时间",
    )
