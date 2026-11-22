"""定义用户知识库中的文献记录模型。"""

from sqlalchemy import CheckConstraint, Column, DateTime, Integer, String
from sqlalchemy.sql import func

from models.base import Base


class KnowledgeBase(Base):
    """存储文献所属用户、文件名称及记录时间。

    文件正文保存在本机文件系统中，本表仅保存元数据。
    沿用原项目的表名和用户标识类型，便于后续对照业务代码。
    """

    __tablename__ = "knowledgebases"

    __table_args__ = (
        CheckConstraint(
            "index_status IN "
            "('unknown', 'not_indexed', 'indexing', 'indexed', 'failed')",
            name="ck_knowledgebases_index_status",
        ),
        CheckConstraint(
            "indexed_chunks IS NULL OR indexed_chunks >= 0",
            name="ck_knowledgebases_indexed_chunks",
        ),
    )

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

    # 记录最近一次索引任务状态，不代表 Elasticsearch 的实时健康状态。
    index_status = Column(
        String(20),
        nullable=False,
        default="not_indexed",
        server_default="not_indexed",
        comment="最近一次索引任务状态",
    )

    # 每次任务使用独立编号，后续更新时防止旧任务覆盖新任务结果。
    index_run_id = Column(
        String(32),
        nullable=True,
        comment="最近一次索引任务编号",
    )

    index_started_at = Column(
        DateTime(timezone=True),
        nullable=True,
        comment="最近一次索引任务开始时间",
    )

    index_finished_at = Column(
        DateTime(timezone=True),
        nullable=True,
        comment="最近一次索引任务结束时间",
    )

    index_error = Column(
        String(1000),
        nullable=True,
        comment="最近一次索引任务的安全错误摘要",
    )

    # 最近一次成功信息独立保存，后续重建失败时仍保留此前成功记录。
    indexed_at = Column(
        DateTime(timezone=True),
        nullable=True,
        comment="最近一次成功建立索引的时间",
    )

    indexed_chunks = Column(
        Integer,
        nullable=True,
        comment="最近一次成功建立索引的分块数量",
    )
