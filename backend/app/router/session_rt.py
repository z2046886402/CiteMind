"""提供需要登录认证的会话管理接口。"""

import logging

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
    Security,
)
from fastapi_jwt import JwtAuthorizationCredentials
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from exceptions.session import SessionNotFoundError
from models.user import User
from schemas.session import (
    SessionCreateRequest,
    SessionCreateResponse,
    SessionListResponse,
    SessionResponse,
)
from service.auth import access_security
from service.session_service import (
    create_session,
    get_owned_session,
    list_sessions,
)
from utils.database import get_db

from pydantic import ValidationError

from schemas.message import MessageListResponse
from service.message_service import list_messages

from schemas.session import SessionDeleteResponse, SessionRenameRequest
from service.session_service import delete_session, rename_session

router = APIRouter(tags=["会话管理"])
logger = logging.getLogger(__name__)


def _require_user_id(
    credentials: JwtAuthorizationCredentials = Security(access_security),
    db: Session = Depends(get_db),
) -> int:
    """为本模块统一校验 JWT 用户编号及账号存在性。"""
    user_id = credentials["user_id"]

    if type(user_id) is not int or user_id <= 0:
        raise HTTPException(status_code=401, detail="登录凭证无效")

    try:
        user = db.get(User, user_id)
    except SQLAlchemyError as exc:
        logger.exception("会话接口用户检查失败")
        raise HTTPException(
            status_code=503,
            detail="数据库暂不可用，请稍后重试",
        ) from exc

    if user is None:
        raise HTTPException(status_code=401, detail="用户不存在")

    return user_id


@router.post(
    "/create_session",
    response_model=SessionCreateResponse,
    status_code=201,
    summary="创建当前用户的会话",
)
def create_user_session(
    options: SessionCreateRequest,
    user_id: int = Depends(_require_user_id),
    db: Session = Depends(get_db),
) -> SessionCreateResponse:
    """创建并持久保存一份空会话。"""
    try:
        return create_session(
            db,
            user_id,
            options.session_name,
            auto_title=options.auto_title,
        )
    except SQLAlchemyError as exc:
        logger.exception("会话创建失败，user_id=%s", user_id)
        raise HTTPException(
            status_code=503,
            detail="会话创建失败，请稍后重试",
        ) from exc


@router.get(
    "/get_sessions",
    response_model=SessionListResponse,
    summary="分页查询当前用户会话",
)
def get_user_sessions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user_id: int = Depends(_require_user_id),
    db: Session = Depends(get_db),
) -> SessionListResponse:
    """按最近更新时间返回当前用户的会话列表。"""
    try:
        return list_sessions(db, user_id, page, page_size)
    except SQLAlchemyError as exc:
        logger.exception("会话列表查询失败，user_id=%s", user_id)
        raise HTTPException(
            status_code=503,
            detail="会话列表暂不可用，请稍后重试",
        ) from exc


@router.get(
    "/sessions/{session_id}",
    response_model=SessionResponse,
    summary="查询当前用户的一份会话",
)
def get_user_session(
    session_id: str = Path(
        ...,
        pattern=r"^[0-9a-f]{16}$",
        description="16 位十六进制会话编号",
    ),
    user_id: int = Depends(_require_user_id),
    db: Session = Depends(get_db),
) -> SessionResponse:
    """验证会话归属后返回详情，不返回其他用户的会话。"""
    try:
        record = get_owned_session(db, user_id, session_id)
        return SessionResponse.model_validate(record)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="会话不存在") from exc
    except SQLAlchemyError as exc:
        logger.exception("会话详情查询失败，user_id=%s", user_id)
        raise HTTPException(
            status_code=503,
            detail="会话详情暂不可用，请稍后重试",
        ) from exc


@router.get(
    "/get_messages",
    response_model=MessageListResponse,
    summary="分页查询当前用户的会话消息",
)
def get_session_messages(
    session_id: str = Query(
        ...,
        pattern=r"^[0-9a-f]{16}$",
        description="需要查询的会话编号",
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user_id: int = Depends(_require_user_id),
    db: Session = Depends(get_db),
) -> MessageListResponse:
    """读取已保存的历史问答，不触发模型调用。"""
    try:
        return list_messages(
            db=db,
            user_id=user_id,
            session_id=session_id,
            page=page,
            page_size=page_size,
        )
    except SessionNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail="会话不存在",
        ) from exc
    except ValidationError as exc:
        logger.exception(
            "历史消息结构异常，user_id=%s，session_id=%s",
            user_id,
            session_id,
        )
        raise HTTPException(
            status_code=500,
            detail="历史消息格式异常，请检查后端日志",
        ) from exc
    except SQLAlchemyError as exc:
        logger.exception(
            "历史消息查询失败，user_id=%s，session_id=%s",
            user_id,
            session_id,
        )
        raise HTTPException(
            status_code=503,
            detail="历史消息暂不可用，请稍后重试",
        ) from exc


@router.patch(
    "/sessions/{session_id}",
    response_model=SessionResponse,
    summary="重命名当前用户的会话",
)
def rename_user_session(
    options: SessionRenameRequest,
    session_id: str = Path(..., pattern=r"^[0-9a-f]{16}$"),
    user_id: int = Depends(_require_user_id),
    db: Session = Depends(get_db),
) -> SessionResponse:
    """验证归属后更新会话名称。"""
    try:
        return rename_session(
            db,
            user_id,
            session_id,
            options.session_name,
        )
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="会话不存在") from exc
    except SQLAlchemyError as exc:
        logger.exception("会话重命名失败，user_id=%s", user_id)
        raise HTTPException(
            status_code=503,
            detail="重命名结果未确认，请刷新会话列表核对",
        ) from exc


@router.delete(
    "/sessions/{session_id}",
    response_model=SessionDeleteResponse,
    summary="删除当前用户的会话及消息",
)
def delete_user_session(
    session_id: str = Path(..., pattern=r"^[0-9a-f]{16}$"),
    user_id: int = Depends(_require_user_id),
    db: Session = Depends(get_db),
) -> SessionDeleteResponse:
    """验证归属后永久删除会话及所属历史。"""
    try:
        return delete_session(db, user_id, session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=404, detail="会话不存在") from exc
    except SQLAlchemyError as exc:
        logger.exception("会话删除失败，user_id=%s", user_id)
        raise HTTPException(
            status_code=503,
            detail="删除结果未确认，请刷新会话列表核对",
        ) from exc
