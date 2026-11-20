"""提供需要登录认证的单轮文献问答接口。"""

import logging

from elastic_transport import TransportError
from elasticsearch import ApiError
from fastapi import APIRouter, HTTPException, Query, Security
from fastapi_jwt import JwtAuthorizationCredentials
from sqlalchemy.exc import SQLAlchemyError

from exceptions.auth import AuthError
from exceptions.chat import ChatServiceError
from exceptions.embedding import EmbeddingServiceError
from exceptions.search import SearchIndexError
from schemas.chat import DocumentChatRequest, DocumentChatResponse
from service.auth import access_security
from service.chat_service import answer_document_question

from exceptions.chat import MessagePersistenceError
from exceptions.session import SessionNotFoundError
from service.session_chat_service import answer_in_session

router = APIRouter(tags=["文献问答"])
logger = logging.getLogger(__name__)


@router.post(
    "/chat_on_docs",
    response_model=DocumentChatResponse,
    summary="基于当前用户文献生成带引用的回答",
)
def chat_on_docs(
    options: DocumentChatRequest,
    session_id: str | None = Query(
        default=None,
        pattern=r"^[0-9a-f]{16}$",
        description="指定时，将问答保存到当前用户拥有的会话",
    ),
    credentials: JwtAuthorizationCredentials = Security(access_security),
) -> DocumentChatResponse:
    """验证用户身份，执行检索增强问答并转换异常响应。"""
    user_id = credentials["user_id"]

    if type(user_id) is not int or user_id <= 0:
        raise HTTPException(status_code=401, detail="登录凭证无效")

    try:
        if session_id is not None:
            return answer_in_session(user_id, session_id, options)

        return answer_document_question(user_id, options)
    except SessionNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail="会话不存在",
        ) from exc
    except MessagePersistenceError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except ChatServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except (EmbeddingServiceError, SearchIndexError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (ApiError, TransportError) as exc:
        logger.error(
            "问答检索服务失败，user_id=%s，error_type=%s",
            user_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=503,
            detail="检索服务暂不可用，请稍后重试",
        ) from exc
    except (SQLAlchemyError, ValueError, KeyError, TypeError) as exc:
        logger.exception("问答数据处理失败，user_id=%s", user_id)
        raise HTTPException(
            status_code=500,
            detail="问答处理失败，请检查后端日志",
        ) from exc
