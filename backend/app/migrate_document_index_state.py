"""为已有文献表增加索引任务状态字段。

本脚本是一次显式的增量结构迁移。
PostgreSQL 在同一事务中执行本次 DDL，失败时整体回滚。
"""

import logging

from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from utils.database import engine


logger = logging.getLogger(__name__)

INDEX_COLUMNS = {
    "index_status",
    "index_run_id",
    "index_started_at",
    "index_finished_at",
    "index_error",
    "indexed_at",
    "indexed_chunks",
}


def migrate() -> None:
    """增加状态字段，并分别设置旧记录和新记录的默认语义。

    Raises:
        RuntimeError: 检测到相关字段已存在，需要先核对迁移情况。
        SQLAlchemyError: 数据库连接或结构变更失败。

    Notes:
        旧文献是否已有索引尚未核对，因此初始化为 unknown。
        后续新上传文献默认使用 not_indexed。
        迁移不尝试根据 Elasticsearch 内容回填历史成功记录。
    """
    with engine.begin() as connection:
        existing_columns = {
            column["name"]
            for column in inspect(connection).get_columns(
                "knowledgebases"
            )
        }

        if INDEX_COLUMNS & existing_columns:
            raise RuntimeError(
                "检测到索引状态字段已存在，本次未执行变更。"
                "如果此前迁移已经成功，无需再次运行；"
                "否则请先核对已有表结构。"
            )

        # 添加字段时使用 unknown，保留对旧文献索引状态的不确定性。
        connection.execute(
            text(
                """
                ALTER TABLE knowledgebases
                    ADD COLUMN index_status VARCHAR(20)
                        NOT NULL DEFAULT 'unknown',
                    ADD COLUMN index_run_id VARCHAR(32),
                    ADD COLUMN index_started_at TIMESTAMPTZ,
                    ADD COLUMN index_finished_at TIMESTAMPTZ,
                    ADD COLUMN index_error VARCHAR(1000),
                    ADD COLUMN indexed_at TIMESTAMPTZ,
                    ADD COLUMN indexed_chunks INTEGER,
                    ADD CONSTRAINT ck_knowledgebases_index_status
                        CHECK (
                            index_status IN (
                                'unknown',
                                'not_indexed',
                                'indexing',
                                'indexed',
                                'failed'
                            )
                        ),
                    ADD CONSTRAINT ck_knowledgebases_indexed_chunks
                        CHECK (
                            indexed_chunks IS NULL
                            OR indexed_chunks >= 0
                        )
                """
            )
        )

        # 改变默认值仅影响以后新增的记录，旧记录继续保留 unknown。
        connection.execute(
            text(
                """
                ALTER TABLE knowledgebases
                ALTER COLUMN index_status
                SET DEFAULT 'not_indexed'
                """
            )
        )


def main() -> int:
    """执行迁移，并通过退出码报告结果。"""
    try:
        migrate()
    except RuntimeError as exc:
        logger.error("%s", exc)
        return 1
    except SQLAlchemyError as exc:
        logger.error(
            "数据库迁移失败，error_type=%s，请检查数据库连接和表结构",
            type(exc).__name__,
        )
        return 1

    logger.info(
        "迁移完成：已有文献状态为 unknown，"
        "新上传文献默认状态为 not_indexed"
    )
    return 0


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    raise SystemExit(main())