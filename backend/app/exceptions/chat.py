"""定义回答模型调用和回答格式校验异常。"""


class ChatServiceError(Exception):
    """回答模型不可用，或输出不符合当前接口约定。"""

class MessagePersistenceError(Exception):
    """回答已生成，但消息保存结果未能确认。"""