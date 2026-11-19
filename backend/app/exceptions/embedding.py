"""定义向量服务的配置、调用与响应校验异常。"""


class EmbeddingServiceError(Exception):
    """向量服务不可用，或返回结果不符合约定。"""