from models.base import Base
from models.user import User
from utils.database import engine


def init_db():
    Base.metadata.create_all(bind=engine)
    print("数据库表初始化完成：users")


if __name__ == "__main__":
    init_db()