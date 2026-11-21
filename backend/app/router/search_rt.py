"""提供需要登录认证的知识库检索接口。"""

import logging

from elastic_transport import TransportError
from elasticsearch import ApiError
from fastapi import APIRouter, HTTPException, Security
from fastapi_jwt import JwtAuthorizationCredentials
from sqlalchemy.exc import SQLAlchemyError
from collections.abc import Callable

from exceptions.auth import AuthError
from exceptions.embedding import EmbeddingServiceError
from exceptions.search import SearchIndexError
from schemas.search import SemanticSearchRequest, SemanticSearchResponse
from service.auth import access_security
from service.retrieval_service import semantic_search
from service.hybrid_retrieval_service import hybrid_search

router = APIRouter(tags=["文献检索"])
logger = logging.getLogger(__name__)


def _execute_search(
    options: SemanticSearchRequest,
    credentials: JwtAuthorizationCredentials,
    search_function: Callable[[int, SemanticSearchRequest], SemanticSearchResponse],
) -> SemanticSearchResponse:
    """统一校验身份及转换异常，保持两个检索接口的错误约定一致。"""
    user_id = credentials["user_id"]

    if type(user_id) is not int or user_id <= 0:
        raise HTTPException(status_code=401, detail="登录凭证无效")

    try:
        return search_function(user_id, options)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except (EmbeddingServiceError, SearchIndexError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (ApiError, TransportError) as exc:
        logger.error(
            "搜索服务请求失败，user_id=%s，error_type=%s",
            user_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=503,
            detail="搜索服务暂不可用，请稍后重试",
        ) from exc
    except (SQLAlchemyError, ValueError, KeyError, TypeError) as exc:
        logger.exception("检索数据处理失败，user_id=%s", user_id)
        raise HTTPException(
            status_code=500,
            detail="检索数据处理失败，请检查后端日志",
        ) from exc

@router.post(
    "/search/semantic",
    response_model=SemanticSearchResponse,
    summary="检索当前用户的相关文献片段",
)
def search_semantic(
    options: SemanticSearchRequest,
    credentials: JwtAuthorizationCredentials = Security(access_security),
) -> SemanticSearchResponse:
    """保留原有纯向量检索接口，供效果对比。"""
    return _execute_search(options, credentials, semantic_search)


@router.post(
    "/search/hybrid",
    response_model=SemanticSearchResponse,
    summary="使用正文关键词与向量混合检索文献",
)
def search_hybrid(
    options: SemanticSearchRequest,
    credentials: JwtAuthorizationCredentials = Security(access_security),
) -> SemanticSearchResponse:
    """执行混合检索；返回分数用于排序，不表示事实可信度。"""
    return _execute_search(options, credentials, hybrid_search)
