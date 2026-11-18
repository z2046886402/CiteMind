"""提供需要登录认证的知识库文献接口。"""

import logging
from schemas.document import DocumentListItem
from service.document_service import list_documents

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Security,
    UploadFile,
)
from fastapi_jwt import JwtAuthorizationCredentials
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from models.user import User
from schemas.document import DocumentUploadResponse
from service.auth import access_security
from service.document_service import upload_document
from utils.database import get_db

from fastapi import Path

from exceptions.document import DocumentNotFoundError
from service.document_service import delete_document


router = APIRouter(tags=["文献管理"])
logger = logging.getLogger(__name__)


@router.post(
    "/upload_files",
    response_model=DocumentUploadResponse,
    summary="上传一份知识库文献",
)
def upload_file(
    files: UploadFile = File(..., description="PDF、DOCX 或 TXT 文献"),
    credentials: JwtAuthorizationCredentials = Security(access_security),
    db: Session = Depends(get_db),
) -> DocumentUploadResponse:
    """校验登录用户，保存文献并返回上传结果。

    用户编号仅从已验证的令牌读取，不接受客户端指定所属用户。
    同步路由由 FastAPI 在线程池中执行，适配当前同步数据库和文件操作。
    """
    user_id = credentials["user_id"]

    if type(user_id) is not int or user_id <= 0:
        raise HTTPException(status_code=401, detail="登录凭证无效")

    try:
        # 令牌有效不代表账号仍存在，因此上传前检查用户记录。
        if db.get(User, user_id) is None:
            raise HTTPException(status_code=401, detail="用户不存在")

        result = upload_document(
            db=db,
            user_id=user_id,
            filename=files.filename or "",
            content=files.file,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (OSError, SQLAlchemyError) as exc:
        logger.exception("文献上传失败，user_id=%s", user_id)
        raise HTTPException(
            status_code=500,
            detail="文献上传失败，请稍后重试",
        ) from exc

    return DocumentUploadResponse(
        status="success",
        message="文献上传成功",
        data=result,
    )

@router.get(
    "/get_files",
    response_model=list[DocumentListItem],
    summary="查询当前用户的知识库文献",
)
def get_files(
    credentials: JwtAuthorizationCredentials = Security(access_security),
    db: Session = Depends(get_db),
) -> list[DocumentListItem]:
    """验证用户身份并返回其文献列表。

    用户编号从 JWT 获取，不接受客户端指定其他用户编号。
    """
    user_id = credentials["user_id"]

    if type(user_id) is not int or user_id <= 0:
        raise HTTPException(status_code=401, detail="登录凭证无效")

    try:
        if db.get(User, user_id) is None:
            raise HTTPException(status_code=401, detail="用户不存在")

        return list_documents(db, user_id)
    except SQLAlchemyError as exc:
        logger.exception("查询文献列表失败，user_id=%s", user_id)
        raise HTTPException(
            status_code=500,
            detail="文献列表查询失败，请稍后重试",
        ) from exc

@router.delete(
    "/delete_file/{document_id}",
    summary="删除当前用户的一份文献",
)
def remove_document(
    document_id: int = Path(..., gt=0, description="真实文献编号"),
    credentials: JwtAuthorizationCredentials = Security(access_security),
    db: Session = Depends(get_db),
) -> dict[str, str | bool]:
    """校验用户身份，并删除其拥有的文献。

    文献归属由业务层查询条件校验，不接受客户端指定所属用户。
    """
    user_id = credentials["user_id"]

    if type(user_id) is not int or user_id <= 0:
        raise HTTPException(status_code=401, detail="登录凭证无效")

    try:
        if db.get(User, user_id) is None:
            raise HTTPException(status_code=401, detail="用户不存在")

        cleanup_completed = delete_document(db, user_id, document_id)
    except DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail="文献不存在") from exc
    except (ValueError, OSError, SQLAlchemyError) as exc:
        logger.exception(
            "文献删除失败，user_id=%s，document_id=%s",
            user_id,
            document_id,
        )
        raise HTTPException(
            status_code=500,
            detail="文献删除失败，请稍后重试",
        ) from exc

    return {
        "status": "success",
        "message": (
            "文献删除成功"
            if cleanup_completed
            else "文献已移出知识库，但原文件清理未完成"
        ),
        "cleanup_completed": cleanup_completed,
    }