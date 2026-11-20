"""读取当前用户会话中已经保存的问答历史。"""

from sqlalchemy.orm import Session

from models.message import Message
from models.session import ChatSession
from schemas.message import MessageListResponse, MessageResponse
from service.session_service import get_owned_session


def _to_message_response(record: Message) -> MessageResponse:
    """将数据库消息转换为前端可复用的问答结构。

    JSONB 中保存的引用列表由 Pydantic 校验并还原为引用模型。
    不重新检索原文献，也不重新调用回答模型。
    """
    return MessageResponse(
        session_id=record.session_id,
        message_id=record.message_id,
        message_no=record.message_no,
        question=record.user_question,
        answer=record.model_answer,
        status=record.status,
        model=record.model,
        references=record.documents,
        used_citation_ids=record.used_citation_ids,
        warnings=record.warnings,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def list_messages(
    db: Session,
    user_id: int,
    session_id: str,
    page: int,
    page_size: int,
) -> MessageListResponse:
    """分页查询当前用户指定会话的消息。

    Args:
        db: 当前请求使用的数据库会话。
        user_id: 已完成身份校验的用户编号。
        session_id: 需要检查归属的会话编号。
        page: 从 1 开始的页码。
        page_size: 每页消息数量，由路由限制上限。

    Returns:
        按 message_no 升序排列的消息历史。

    Raises:
        SessionNotFoundError: 会话不存在或不属于当前用户。
        SQLAlchemyError: 数据库查询失败。
        ValidationError: 已保存的消息数据不符合响应结构。
    """
    # 区分“合法空会话”和“无权访问或不存在的会话”。
    get_owned_session(db, user_id, session_id)

    query = (
        db.query(Message)
        .join(
            ChatSession,
            Message.session_id == ChatSession.session_id,
        )
        .filter(
            Message.session_id == session_id,
            ChatSession.user_id == user_id,
        )
    )

    total = query.count()

    records = (
        query.order_by(Message.message_no.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return MessageListResponse(
        session_id=session_id,
        total=total,
        page=page,
        page_size=page_size,
        messages=[
            _to_message_response(record)
            for record in records
        ],
    )