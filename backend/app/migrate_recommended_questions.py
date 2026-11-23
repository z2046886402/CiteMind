"""为已有消息表增加推荐追问字段。"""

import logging

from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from utils.database import engine


logger = logging.getLogger(__name__)


def migrate() -> None:
    """增加字段，并将旧消息初始化为空推荐列表。"""
    with engine.begin() as connection:
        columns = {
            column["name"]
            for column in inspect(connection).get_columns(
                "messages"
            )
        }

        if "recommended_questions" in columns:
            raise RuntimeError(
                "推荐追问字段已经存在，本次未执行变更。"
                "如果此前迁移成功，无需重复执行。"
            )

        connection.execute(
            text(
                """
                ALTER TABLE messages
                ADD COLUMN recommended_questions
                    JSONB NOT NULL DEFAULT '[]'::jsonb
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
            "推荐追问字段迁移失败，error_type=%s",
            type(exc).__name__,
        )
        return 1

    logger.info("推荐追问字段迁移完成")
    return 0


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s: %(message)s",
    )
    raise SystemExit(main())