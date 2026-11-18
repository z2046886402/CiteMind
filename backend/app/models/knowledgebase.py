"""定义用户知识库中的文献记录模型。"""

from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.sql import func

from models.base import Base


class KnowledgeBase(Base):
    """存储文献所属用户、文件名称及记录时间。

    文件正文保存在本机文件系统中，本表仅保存元数据。
    沿用原项目的表名和用户标识类型，便于后续对照业务代码。
    """

    __tablename__ = "knowledgebases"

    id = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        comment="文献记录编号",
    )

    # 沿用原项目的字符串类型；接口中将 JWT 用户编号转换为字符串。
    user_id = Column(
        String(255),
        nullable=False,
        index=True,
        comment="文献所属用户编号",
    )

    file_name = Column(
        String(255),
        nullable=False,
        comment="文献文件名称",
    )

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="记录创建时间",
    )

    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="记录最近更新时间",
    )