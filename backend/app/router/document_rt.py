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

from exceptions.document import DocumentParseError
from schemas.document import DocumentParseResponse
from service.document_service import parse_document

from schemas.document import DocumentChunkRequest, DocumentChunkResponse
from service.document_service import chunk_document

from exceptions.auth import AuthError
from exceptions.embedding import EmbeddingServiceError
from schemas.embedding import (
    DocumentEmbeddingRequest,
    DocumentEmbeddingResponse,
)
from service.document_embedding_service import preview_document_embeddings

from elastic_transport import TransportError
from elasticsearch import ApiError

from exceptions.search import SearchIndexError
from schemas.search import DocumentIndexResponse
from service.document_index_service import index_document

from fastapi import Response
from service.document_service import read_pdf_document


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

    except (SearchIndexError, ApiError, TransportError) as exc:
        # 搜索清理发生在数据库删除提交之前，失败时不继续删除记录。
        logger.error(
            "删除文献时搜索分块清理失败，user_id=%s，document_id=%s，error_type=%s",
            user_id,
            document_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=503,
            detail="搜索分块清理未完成，本次未删除文献记录，请稍后重试",
        ) from exc

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


@router.post(
    "/documents/{document_id}/parse",
    response_model=DocumentParseResponse,
    summary="提取当前用户文献的文本",
)
def parse_document_text(
    document_id: int = Path(..., gt=0, description="真实文献编号"),
    credentials: JwtAuthorizationCredentials = Security(access_security),
    db: Session = Depends(get_db),
) -> DocumentParseResponse:
    """验证用户及文献归属，同步返回基础文本提取结果。"""
    user_id = credentials["user_id"]

    if type(user_id) is not int or user_id <= 0:
        raise HTTPException(status_code=401, detail="登录凭证无效")

    try:
        if db.get(User, user_id) is None:
            raise HTTPException(status_code=401, detail="用户不存在")

        return parse_document(db, user_id, document_id)
    except DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail="文献不存在") from exc
    except DocumentParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (ValueError, OSError, SQLAlchemyError) as exc:
        logger.exception(
            "文献解析服务失败，user_id=%s，document_id=%s",
            user_id,
            document_id,
        )
        raise HTTPException(
            status_code=500,
            detail="文献解析失败，请检查原文件存储或稍后重试",
        ) from exc


@router.post(
    "/documents/{document_id}/chunks",
    response_model=DocumentChunkResponse,
    summary="生成当前用户文献的文本分块",
)
def generate_document_chunks(
    options: DocumentChunkRequest,
    document_id: int = Path(..., gt=0, description="真实文献编号"),
    credentials: JwtAuthorizationCredentials = Security(access_security),
    db: Session = Depends(get_db),
) -> DocumentChunkResponse:
    """根据请求参数同步生成分块，不写入数据库或向量索引。"""
    user_id = credentials["user_id"]

    if type(user_id) is not int or user_id <= 0:
        raise HTTPException(status_code=401, detail="登录凭证无效")

    try:
        if db.get(User, user_id) is None:
            raise HTTPException(status_code=401, detail="用户不存在")

        return chunk_document(db, user_id, document_id, options)
    except DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail="文献不存在") from exc
    except DocumentParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail="分块服务暂不可用，请检查后端编码器初始化日志",
        ) from exc
    except (OSError, SQLAlchemyError) as exc:
        logger.exception(
            "文献分块失败，user_id=%s，document_id=%s",
            user_id,
            document_id,
        )
        raise HTTPException(
            status_code=500,
            detail="文献分块失败，请稍后重试",
        ) from exc


@router.post(
    "/documents/{document_id}/embeddings/preview",
    response_model=DocumentEmbeddingResponse,
    summary="小批量验证文献分块向量化",
)
def preview_embeddings(
    options: DocumentEmbeddingRequest,
    document_id: int = Path(..., gt=0, description="真实文献编号"),
    credentials: JwtAuthorizationCredentials = Security(access_security),
) -> DocumentEmbeddingResponse:
    """验证登录身份，并为指定文献的前若干块生成向量。

    此接口会调用远程模型，但不会保存向量或创建搜索索引。
    数据库会话由业务层限定在文献读取阶段。
    """
    user_id = credentials["user_id"]

    if type(user_id) is not int or user_id <= 0:
        raise HTTPException(status_code=401, detail="登录凭证无效")

    try:
        return preview_document_embeddings(
            user_id=user_id,
            document_id=document_id,
            options=options,
        )
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail="文献不存在") from exc
    except DocumentParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except EmbeddingServiceError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail="文本编码器暂不可用，请检查后端日志",
        ) from exc
    except (OSError, SQLAlchemyError) as exc:
        logger.exception(
            "文献向量化验证失败，user_id=%s，document_id=%s",
            user_id,
            document_id,
        )
        raise HTTPException(
            status_code=500,
            detail="文献处理失败，请稍后重试",
        ) from exc


@router.post(
    "/documents/{document_id}/index",
    response_model=DocumentIndexResponse,
    summary="为当前用户文献建立搜索索引",
)
def build_document_index(
    options: DocumentChunkRequest,
    document_id: int = Path(..., gt=0, description="真实文献编号"),
    credentials: JwtAuthorizationCredentials = Security(access_security),
) -> DocumentIndexResponse:
    """同步完成整篇文献的分块、向量生成和搜索索引写入。"""
    user_id = credentials["user_id"]

    if type(user_id) is not int or user_id <= 0:
        raise HTTPException(status_code=401, detail="登录凭证无效")

    try:
        return index_document(user_id, document_id, options)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except DocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail="文献不存在") from exc
    except DocumentParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (EmbeddingServiceError, SearchIndexError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail="文本编码器暂不可用，请检查后端日志",
        ) from exc
    except (ApiError, TransportError) as exc:
        logger.error(
            "搜索服务请求失败，document_id=%s，error_type=%s",
            document_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=503,
            detail="搜索服务请求失败，可能已有部分写入，请排查后重试",
        ) from exc
    except (OSError, SQLAlchemyError) as exc:
        logger.exception("文献索引处理失败，document_id=%s", document_id)
        raise HTTPException(
            status_code=500,
            detail="文献处理失败，请稍后重试",
        ) from exc


@router.get(
    "/documents/{document_id}/pdf",
    response_class=Response,
    responses={
        200: {
            "content": {
                "application/pdf": {}
            }
        }
    },
    summary="预览当前用户的 PDF 原文件",
)
def preview_document_pdf(
    document_id: int = Path(
        ...,
        gt=0,
        description="真实文献编号",
    ),
    credentials: JwtAuthorizationCredentials = Security(
        access_security
    ),
    db: Session = Depends(get_db),
) -> Response:
    """检查登录用户及文献归属，返回 PDF 二进制内容。"""
    user_id = credentials["user_id"]

    if type(user_id) is not int or user_id <= 0:
        raise HTTPException(
            status_code=401,
            detail="登录凭证无效",
        )

    try:
        if db.get(User, user_id) is None:
            raise HTTPException(
                status_code=401,
                detail="用户不存在",
            )

        content = read_pdf_document(
            db,
            user_id,
            document_id,
        )

    except DocumentNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail="文献不存在或原文件不可用",
        ) from exc

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    except (OSError, SQLAlchemyError) as exc:
        logger.error(
            "PDF 原文读取失败，user_id=%s，document_id=%s，"
            "error_type=%s",
            user_id,
            document_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=500,
            detail="原文件读取失败，请稍后重试",
        ) from exc

    return Response(
        content=content,
        media_type="application/pdf",
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": (
                'inline; filename="document.pdf"'
            ),
        },
    )
