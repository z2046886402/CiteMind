from router import user_rt
from router import document_rt
from router import search_rt
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from utils.database import get_db
from router import chat_rt


app = FastAPI(title="CiteMind API")

app.include_router(user_rt.router)
# 注册文献管理接口，具体权限由各接口的认证依赖控制。
app.include_router(document_rt.router)
# 注册文献检索接口，身份认证由路由的 Security 依赖执行。
app.include_router(search_rt.router)
# 注册单轮文献问答接口。
app.include_router(chat_rt.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5181"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "success", "message": "CiteMind 后端运行正常"}

@app.get("/health/db")
def health_db(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError:
        raise HTTPException(
            status_code=503,
            detail="数据库连接失败，请检查数据库服务和配置",
        )

    return {"status": "success", "message": "数据库连接正常"}

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app_main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )