import logging

from fastapi import APIRouter, Depends, HTTPException, Security
from fastapi_jwt import JwtAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from exceptions.auth import AuthError
from service.auth import access_security, authenticate, register_user
from utils.database import get_db

router = APIRouter(tags=["用户管理"])
logger = logging.getLogger(__name__)


class RegisterRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1)


@router.post("/register")
def register(
    request: RegisterRequest,
    db: Session = Depends(get_db),
):
    try:
        register_user(db, request.username, request.password)
    except AuthError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc
    except SQLAlchemyError as exc:
        logger.exception("注册时数据库操作失败")
        raise HTTPException(
            status_code=500,
            detail="注册失败，请稍后重试",
        ) from exc

    return {"message": "User registered successfully"}

class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1)


@router.post("/login")
def login(
    request: LoginRequest,
    db: Session = Depends(get_db),
):
    try:
        token = authenticate(db, request.username, request.password)
    except AuthError as exc:
        raise HTTPException(
            status_code=401,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except SQLAlchemyError as exc:
        logger.exception("登录时数据库操作失败")
        raise HTTPException(
            status_code=500,
            detail="登录失败，请稍后重试",
        ) from exc

    return {
        "access_token": token,
        "token_type": "bearer",
    }

@router.get("/users/me")
def get_current_user(
    credentials: JwtAuthorizationCredentials = Security(access_security),
):
    return {
        "user_id": credentials["user_id"],
        "username": credentials["user_name"],
    }