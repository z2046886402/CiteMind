"""定义知识库文献接口的响应结构。"""

from pydantic import BaseModel
from datetime import datetime


class DocumentUploadData(BaseModel):
    """描述上传成功的文献，不暴露服务器本机存储路径。"""

    file_id: str
    file_name: str
    file_size: int


class DocumentUploadResponse(BaseModel):
    """提供与原项目风格一致的上传结果。"""

    status: str
    message: str
    data: DocumentUploadData

class DocumentListItem(BaseModel):
    """描述知识库列表中的单条文献记录。

    不返回服务器存储路径，所属用户由后端认证上下文确定。
    """

    id: int
    file_name: str
    created_at: datetime
    updated_at: datetime