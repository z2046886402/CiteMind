"""处理会话创建、分页查询和归属校验。"""

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from exceptions.session import SessionNotFoundError
from models.session import ChatSession
from schemas.session import (
    SessionCreateResponse,
    SessionListResponse,
    SessionResponse,
)

from datetime import datetime, timezone

from models.message import Message
from schemas.session import SessionDeleteResponse


def create_session(
    db: Session,
    user_id: int,
    session_name: str,
) -> SessionCreateResponse:
    """创建一份属于当前用户的空会话。

    Args:
        db: 当前请求使用的数据库会话。
        user_id: 已完成身份及账号存在性校验的用户编号。
        session_name: 已通过请求模型校验的名称。

    Returns:
        已成功提交的会话信息。

    Raises:
        SQLAlchemyError: 数据库写入失败。
    """
    record = ChatSession(
        user_id=user_id,
        session_name=session_name,
    )

    try:
        db.add(record)
        db.flush()
        db.refresh(record)

        # 提交前读取响应数据，避免提交后才加载默认时间等字段。
        response = SessionCreateResponse.model_validate(record)
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise

    return response


def list_sessions(
    db: Session,
    user_id: int,
    page: int,
    page_size: int,
) -> SessionListResponse:
    """分页查询当前用户的会话，最近更新的排在前面。"""
    query = db.query(ChatSession).filter(
        ChatSession.user_id == user_id
    )

    total = query.count()

    records = (
        query.order_by(
            ChatSession.updated_at.desc(),
            ChatSession.session_id.desc(),
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return SessionListResponse(
        user_id=user_id,
        total=total,
        page=page,
        page_size=page_size,
        sessions=[
            SessionResponse.model_validate(record)
            for record in records
        ],
    )


def get_owned_session(
    db: Session,
    user_id: int,
    session_id: str,
    *,
    lock: bool = False,
) -> ChatSession:
    """取得当前用户拥有的会话，可选择加排他行锁。

    Args:
        db: 当前操作使用的数据库会话。
        user_id: 已验证的用户编号。
        session_id: 目标会话编号。
        lock: 保存消息等需要串行执行的操作应设置为 True。

    Returns:
        当前数据库会话管理的会话对象。

    Raises:
        SessionNotFoundError: 会话不存在或不属于当前用户。

    Notes:
        行锁在当前数据库事务结束后释放。
        仅查询详情时不需要加锁。
    """
    query = db.query(ChatSession).filter(
        ChatSession.session_id == session_id,
        ChatSession.user_id == user_id,
    )

    if lock:
        query = query.with_for_update()

    record = query.first()

    if record is None:
        raise SessionNotFoundError("会话不存在")

    return record


def rename_session(
    db: Session,
    user_id: int,
    session_id: str,
    session_name: str,
) -> SessionResponse:
    """重命名当前用户的会话，并更新最近修改时间。

    与消息保存共用会话行锁，避免并发修改时互相覆盖。
    """
    try:
        record = get_owned_session(
            db,
            user_id,
            session_id,
            lock=True,
        )

        record.session_name = session_name
        record.updated_at = datetime.now(timezone.utc)

        db.flush()
        db.refresh(record)

        response = SessionResponse.model_validate(record)
        db.commit()
        return response
    except SQLAlchemyError:
        db.rollback()
        raise


def delete_session(
    db: Session,
    user_id: int,
    session_id: str,
) -> SessionDeleteResponse:
    """删除当前用户会话，并由数据库级联删除所属消息。

    Args:
        db: 当前请求使用的数据库会话。
        user_id: 已验证的用户编号。
        session_id: 需要校验归属的会话编号。

    Returns:
        已提交的删除结果及删除前的消息数量。

    Raises:
        SessionNotFoundError: 会话不存在或不属于当前用户。
        SQLAlchemyError: 数据库删除或提交失败。

    Notes:
        会话行锁与消息保存流程协调，防止删除期间继续追加消息。
        数据库提交后无法通过事务回滚恢复历史。
    """
    try:
        record = get_owned_session(
            db,
            user_id,
            session_id,
            lock=True,
        )

        message_count = (
            db.query(Message)
            .filter(Message.session_id == session_id)
            .count()
        )

        response = SessionDeleteResponse(
            session_id=session_id,
            deleted_messages=message_count,
        )

        # messages.session_id 的 ON DELETE CASCADE 在同一事务内生效。
        db.delete(record)
        db.commit()
        return response
    except SQLAlchemyError:
        db.rollback()
        raise
