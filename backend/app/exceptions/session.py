"""定义会话管理的业务异常。"""


class SessionNotFoundError(Exception):
    """会话不存在，或不属于当前用户。"""