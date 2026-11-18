import os
import secrets
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv
from fastapi_jwt import JwtAccessBearerCookie

from utils.password import hash_password, verify_password

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from exceptions.auth import AuthError
from models.user import User
from utils.password import hash_password

env_path = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(env_path)

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")

if not JWT_SECRET_KEY:
    raise RuntimeError("请在 backend/.env 中配置 JWT_SECRET_KEY")

access_security = JwtAccessBearerCookie(
    secret_key=JWT_SECRET_KEY,
    auto_error=True,
    access_expires_delta=timedelta(days=2),
)

def register_user(db: Session, username: str, password: str):
    if len(password.encode("utf-8")) > 72:
        raise AuthError("密码不能超过 72 个 UTF-8 字节")

    existing_user = (
        db.query(User)
        .filter(User.username == username)
        .first()
    )

    if existing_user:
        raise AuthError("用户名已存在")

    new_user = User(
        username=username,
        password_hash=hash_password(password),
    )

    try:
        db.add(new_user)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AuthError("用户名已存在") from exc
    except SQLAlchemyError:
        db.rollback()
        raise

def create_token(user_id: int, username: str) -> str:
    subject = {
        "user_id": user_id,
        "user_name": username,
        "salting": secrets.token_hex(16),
    }

    return access_security.create_access_token(subject=subject)


def authenticate(db: Session, username: str, password: str) -> str:
    if len(password.encode("utf-8")) > 72:
        raise AuthError("用户名或密码错误")

    user = (
        db.query(User)
        .filter(User.username == username)
        .first()
    )

    if user is None:
        raise AuthError("用户名或密码错误")

    if not verify_password(password, user.password_hash):
        raise AuthError("用户名或密码错误")

    return create_token(user.id, user.username)