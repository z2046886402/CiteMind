"""将单轮文献问答结果保存到指定会话。"""

import logging
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError

from exceptions.chat import MessagePersistenceError
from models.message import Message
from schemas.chat import DocumentChatRequest, DocumentChatResponse
from service.chat_service import answer_document_question
from service.session_service import get_owned_session
from utils.database import SessionLocal
from service.context_service import load_recent_history
logger = logging.getLogger(__name__)


def answer_in_session(
    user_id: int,
    session_id: str,
    options: DocumentChatRequest,
) -> DocumentChatResponse:
    """生成回答，并将问答结果和引用快照保存到当前用户会话。

    Args:
        user_id: 从已验证 JWT 中取得的用户编号。
        session_id: 客户端指定、需要校验归属的会话编号。
        options: 问题及检索参数。

    Returns:
        包含消息编号和保存时间的问答结果。

    Raises:
        SessionNotFoundError: 会话不存在或不属于当前用户。
        MessagePersistenceError: 回答生成后，数据库保存结果未确认。
        ChatServiceError: 回答模型调用或引用校验失败。

    Notes:
        模型调用期间不持有数据库连接和会话行锁。
        保存阶段重新校验归属，并通过会话行锁串行分配消息序号。
        保存历史不代表模型已经使用历史作为多轮上下文。
    """
    # 先校验会话，避免为无权访问的会话产生模型调用。
    # 在已验证归属的会话内读取历史快照，随后释放数据库会话。
    with SessionLocal() as db:
        history = load_recent_history(
            db,
            user_id,
            session_id,
        )

        result = answer_document_question(
            user_id,
            options,
            history=history,
        )

    return save_session_answer(user_id, session_id, result)


def save_session_answer(
    user_id: int,
    session_id: str,
    result: DocumentChatResponse,
) -> DocumentChatResponse:
    """保存已经完成生成及校验的回答。

    保存前重新校验会话归属，并通过会话行锁分配消息序号。
    消息新增与会话更新时间在同一事务中提交。

    Args:
        user_id: 已验证的用户编号。
        session_id: 目标会话编号。
        result: 已完成引用校验的完整问答结果。

    Returns:
        包含消息编号和保存时间的结果。

    Raises:
        SessionNotFoundError: 会话已删除或不属于当前用户。
        MessagePersistenceError: 数据库提交结果未确认。
    """
    with SessionLocal() as db:
        try:
            # 会话可能在模型调用期间发生变化，保存前重新校验。
            session = get_owned_session(
                db,
                user_id,
                session_id,
                lock=True,
            )

            latest_number = (
                db.query(func.max(Message.message_no))
                .filter(Message.session_id == session_id)
                .scalar()
            )
            next_number = (latest_number or 0) + 1
            saved_at = datetime.now(timezone.utc)

            message = Message(
                session_id=session_id,
                message_no=next_number,
                user_question=result.question,
                model_answer=result.answer,
                status=result.status,
                model=result.model,
                # 保存结构化快照，而不是再套一层 JSON 字符串。
                documents=[
                    reference.model_dump(mode="json")
                    for reference in result.references
                ],
                used_citation_ids=list(result.used_citation_ids),
                warnings=list(result.warnings),
                created_at=saved_at,
                updated_at=saved_at,
            )

            db.add(message)

            # 新增子表消息不会自动触发父会话的更新时间。
            session.updated_at = saved_at

            db.flush()

            # 提交前收集响应字段，避免提交后再依赖 ORM 懒加载。
            response = result.model_copy(
                update={
                    "session_id": session_id,
                    "message_id": message.message_id,
                    "message_no": next_number,
                    "created_at": saved_at,
                }
            )

            # 消息新增与会话更新时间属于同一数据库事务。
            db.commit()
        except SQLAlchemyError as exc:
            db.rollback()
            logger.exception(
                "问答消息保存未确认，user_id=%s，session_id=%s",
                user_id,
                session_id,
            )
            raise MessagePersistenceError(
                "回答已生成，但保存结果未确认，请先核对会话记录再决定是否重试"
            ) from exc

    logger.info(
        "问答消息保存成功，user_id=%s，session_id=%s，message_no=%s",
        user_id,
        session_id,
        next_number,
    )
    return response
