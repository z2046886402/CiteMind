"""定义文献管理中的业务异常。"""


class DocumentNotFoundError(Exception):
    """文献不存在，或文献不属于当前用户。"""