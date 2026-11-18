"""初始化本地开发数据库中尚不存在的业务表。"""

import logging

from models.base import Base
from models.knowledgebase import KnowledgeBase
from models.user import User
from utils.database import engine

logger = logging.getLogger(__name__)


def init_db() -> None:
    """创建已注册且尚不存在的数据库表。

    模型模块必须先导入，SQLAlchemy 才能收集对应的表定义。
    此操作不会修改已有表结构；后续结构变更使用 Alembic 管理。

    Raises:
        SQLAlchemyError: 数据库连接或建表操作失败时向上抛出。
    """
    Base.metadata.create_all(bind=engine)
    logger.info("数据库初始化完成，已检查 users、knowledgebases 表")


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    init_db()