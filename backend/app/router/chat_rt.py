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

import json

from anyio import CancelScope
from fastapi.responses import StreamingResponse
from starlette.concurrency import iterate_in_threadpool, run_in_threadpool

from service.context_service import load_recent_history
from service.document_chat_stream_service import stream_answer_in_session
from utils.database import SessionLocal

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


@router.post(
    "/chat_on_docs/stream",
    response_class=StreamingResponse,
    summary="流式生成文献回答并保存到会话",
)
def chat_on_docs_stream(
    options: DocumentChatRequest,
    session_id: str = Query(
        ...,
        pattern=r"^[0-9a-f]{16}$",
        description="当前用户拥有的会话编号",
    ),
    credentials: JwtAuthorizationCredentials = Security(access_security),
) -> StreamingResponse:
    """验证会话后建立 SSE 响应。

    建立响应前的认证和会话错误使用 HTTP 状态码返回。
    建立响应后的生成、校验及保存错误使用 error 事件返回。
    """
    user_id = credentials["user_id"]

    if type(user_id) is not int or user_id <= 0:
        raise HTTPException(status_code=401, detail="登录凭证无效")

    try:
        # 在响应建立前校验归属，避免为无权访问的会话调用模型。
        with SessionLocal() as db:
            history = load_recent_history(db, user_id, session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail="会话不存在",
        ) from exc
    except SQLAlchemyError as exc:
        logger.error(
            "流式问答上下文读取失败，user_id=%s，error_type=%s",
            user_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=503,
            detail="会话读取失败，请稍后重试",
        ) from exc

    def encode_event(name: str, data: dict) -> str:
        """使用 JSON 编码事件数据，保留正文中的换行和特殊字符。"""
        payload = json.dumps(data, ensure_ascii=False)
        return f"event: {name}\ndata: {payload}\n\n"

    async def event_body():
        """在线程池执行同步业务，并在退出时释放生成器资源。"""
        events = stream_answer_in_session(
            user_id,
            session_id,
            options,
            history,
        )

        try:
            async for name, data in iterate_in_threadpool(events):
                yield encode_event(name, data)

        except (
            ChatServiceError,
            MessagePersistenceError,
            EmbeddingServiceError,
            SearchIndexError,
        ) as exc:
            yield encode_event(
                "error",
                {
                    "code": (
                        "SAVE_UNCONFIRMED"
                        if isinstance(
                            exc,
                            MessagePersistenceError,
                        )
                        else "ANSWER_FAILED"
                    ),
                    "message": str(exc),
                },
            )

        except SessionNotFoundError:
            yield encode_event(
                "error",
                {
                    "code": "SESSION_NOT_FOUND",
                    "message": "会话已不存在",
                },
            )

        except Exception as exc:
            # 仅记录异常类型，避免将凭证、问题或资料正文写入日志。
            logger.error(
                "流式问答处理失败，user_id=%s，error_type=%s",
                user_id,
                type(exc).__name__,
            )
            yield encode_event(
                "error",
                {
                    "code": "PROCESSING_FAILED",
                    "message": "问答处理未完成",
                },
            )

        finally:
            # 连接取消时仍执行清理；同步调用需先返回才能关闭生成器。
            with CancelScope(shield=True):
                await run_in_threadpool(events.close)

    return StreamingResponse(
        event_body(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
