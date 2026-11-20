"""从当前用户的会话读取有界的历史对话上下文。"""

import re

from sqlalchemy.orm import Session

from models.message import Message
from models.session import ChatSession
from schemas.context import ConversationTurn
from service.session_service import get_owned_session

MAX_HISTORY_TURNS = 3
MAX_HISTORY_CHARACTERS = 6000
MAX_HISTORY_ANSWER_CHARACTERS = 1500

OLD_CITATION_PATTERN = re.compile(r"##[0-9]+\$\$")


def load_recent_history(
    db: Session,
    user_id: int,
    session_id: str,
) -> list[ConversationTurn]:
    """读取最近三轮问答，并按时间顺序返回。

    Args:
        db: 当前读取操作使用的数据库会话。
        user_id: 已验证的用户编号。
        session_id: 需要校验归属的会话编号。

    Returns:
        从旧到新排列的历史摘要。

    Notes:
        对话正文总预算为 6000 个 Python 字符，不包含标题和 JSON 开销。
        优先保留最近记录，不加载历史引用正文。
        清除旧引用标记，避免与本轮引用编号混淆。
    """
    get_owned_session(db, user_id, session_id)

    records = (
        db.query(Message)
        .join(
            ChatSession,
            Message.session_id == ChatSession.session_id,
        )
        .filter(
            Message.session_id == session_id,
            ChatSession.user_id == user_id,
        )
        .order_by(Message.message_no.desc())
        .limit(MAX_HISTORY_TURNS)
        .all()
    )

    history: list[ConversationTurn] = []
    remaining = MAX_HISTORY_CHARACTERS

    for record in records:
        question = record.user_question[:1000]

        if len(question) > remaining:
            break

        answer = OLD_CITATION_PATTERN.sub("", record.model_answer)
        answer = answer[
            :min(
                MAX_HISTORY_ANSWER_CHARACTERS,
                remaining - len(question),
            )
        ]

        titles = sorted({
            item["file_name"]
            for item in record.documents
            if isinstance(item, dict)
            and isinstance(item.get("file_name"), str)
        })[:3]

        history.append(
            ConversationTurn(
                message_no=record.message_no,
                question=question,
                answer=answer,
                status=record.status,
                source_titles=titles,
            )
        )

        remaining -= len(question) + len(answer)

    # 查询时倒序取最近记录，发送给模型前恢复对话顺序。
    history.reverse()
    return history