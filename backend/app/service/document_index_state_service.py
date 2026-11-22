"""管理文献索引任务状态，并防止旧任务覆盖新任务结果。"""

import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy.exc import OperationalError

from exceptions.auth import AuthError
from exceptions.document import (
    DocumentNotFoundError,
    DocumentParseError,
)
from exceptions.embedding import EmbeddingServiceError
from exceptions.search import SearchIndexError
from models.knowledgebase import KnowledgeBase
from models.user import User
from utils.database import SessionLocal


logger = logging.getLogger(__name__)

# 进程异常退出后，允许后续请求接管超时任务。
# 此时间用于任务接管判断，不会主动终止原来的模型请求。
INDEX_RUN_TIMEOUT = timedelta(minutes=30)


def start_index_run(user_id: int, document_id: int) -> str:
    """验证归属并登记一次索引任务，提交后返回任务编号。

    同一文献存在未超时任务时拒绝重复执行。
    超时任务可以由新编号接管，旧任务写入前必须重新核对编号。
    """
    run_id = uuid4().hex
    now = datetime.now(timezone.utc)

    try:
        with SessionLocal() as db:
            if db.get(User, user_id) is None:
                raise AuthError("用户不存在")

            record = (
                db.query(KnowledgeBase)
                .filter(
                    KnowledgeBase.id == document_id,
                    KnowledgeBase.user_id == str(user_id),
                )
                .with_for_update(nowait=True)
                .first()
            )

            if record is None:
                raise DocumentNotFoundError("文献不存在")

            if (
                record.index_status == "indexing"
                and record.index_started_at is not None
                and now - record.index_started_at < INDEX_RUN_TIMEOUT
            ):
                raise SearchIndexError(
                    "该文献已有索引任务正在执行，请稍后刷新状态"
                )

            record.index_status = "indexing"
            record.index_run_id = run_id
            record.index_started_at = now
            record.index_finished_at = None
            record.index_error = None

            # 保留最近一次成功时间和分块数，供重建失败后查看。
            db.commit()

    except OperationalError as exc:
        # PostgreSQL：目标记录已被其他索引或删除操作锁定。
        if getattr(exc.orig, "pgcode", None) == "55P03":
            raise SearchIndexError(
                "文献正在被其他操作处理，请稍后重试"
            ) from exc

        raise

    return run_id


def _failure_summary(error: Exception) -> str:
    """生成可持久化的错误摘要，避免保存远程接口的原始异常内容。"""
    if isinstance(
        error,
        (
            DocumentParseError,
            EmbeddingServiceError,
            SearchIndexError,
        ),
    ):
        # 这些业务异常由项目服务层提供安全说明。
        return str(error)[:1000]

    if isinstance(error, ValueError):
        return "分块参数、索引配置或文献规模不符合要求"

    return (
        f"索引处理失败（{type(error).__name__}），"
        "请检查后端日志"
    )


def mark_index_run_failed(
    user_id: int,
    document_id: int,
    run_id: str,
    error: Exception,
) -> int:
    """仅将仍属于当前任务的执行中状态更新为失败。

    Returns:
        实际更新的记录数量。文献已删除、任务已被接管，
        或任务已经成功时返回 0。

    Notes:
        使用带条件的 UPDATE，避免先查询再更新产生竞态。
        不清空此前成功建立索引的时间和分块数量。
    """
    with SessionLocal() as db:
        changed = (
            db.query(KnowledgeBase)
            .filter(
                KnowledgeBase.id == document_id,
                KnowledgeBase.user_id == str(user_id),
                KnowledgeBase.index_run_id == run_id,
                KnowledgeBase.index_status == "indexing",
            )
            .update(
                {
                    "index_status": "failed",
                    "index_finished_at": datetime.now(timezone.utc),
                    "index_error": _failure_summary(error),
                },
                synchronize_session=False,
            )
        )

        db.commit()

    return changed