"""为会话表增加首次自动命名标识。"""

import logging

from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from utils.database import engine


logger = logging.getLogger(__name__)


def migrate() -> None:
    """增加字段；已有会话默认关闭自动命名，保留当前名称。"""
    with engine.begin() as connection:
        columns = {
            column["name"]
            for column in inspect(connection).get_columns(
                "sessions"
            )
        }

        if "auto_title_pending" in columns:
            raise RuntimeError(
                "自动标题字段已经存在，本次未执行变更。"
                "如果此前迁移成功，无需重复执行。"
            )

        connection.execute(
            text(
                """
                ALTER TABLE sessions
                ADD COLUMN auto_title_pending
                    BOOLEAN NOT NULL DEFAULT FALSE
                """
            )
        )


def main() -> int:
    """执行显式迁移，通过退出码报告结果。"""
    try:
        migrate()
    except RuntimeError as exc:
        logger.error("%s", exc)
        return 1
    except SQLAlchemyError as exc:
        logger.error(
            "自动标题字段迁移失败，error_type=%s",
            type(exc).__name__,
        )
        return 1

    logger.info("会话自动标题字段迁移完成")
    return 0


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s: %(message)s",
    )
    raise SystemExit(main())