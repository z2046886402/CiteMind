"""清理指定用户、指定文献对应的搜索分块。"""

import logging

from exceptions.search import SearchIndexError
from service.search_index_service import ensure_chunk_index
from utils.es_client import create_es_client, get_chunk_index_name

logger = logging.getLogger(__name__)


def delete_document_chunks(user_id: int, document_id: int) -> int:
    """删除一份文献的全部索引分块，并验证清理结果。

    Args:
        user_id: 已验证的文献所属用户编号。
        document_id: PostgreSQL 中的真实文献编号。

    Returns:
        本次实际删除的分块数量；索引不存在时返回 0。

    Raises:
        ValueError: 用户编号或文献编号无效。
        SearchIndexError: 索引配置异常或分块未清理干净。
        ApiError: Elasticsearch API 请求失败。
        TransportError: 无法连接 Elasticsearch。

    Notes:
        调用方必须持有目标文献的数据库行锁。
        当前建立索引和删除流程都遵循该锁，防止边删边写。
        清理可重复执行，不会创建缺失索引。
    """
    if (
        type(user_id) is not int
        or type(document_id) is not int
        or user_id <= 0
        or document_id <= 0
    ):
        raise ValueError("用户编号和文献编号必须是正整数")

    index_name = get_chunk_index_name()

    query = {
        "bool": {
            "filter": [
                {"term": {"user_id": str(user_id)}},
                {"term": {"doc_id": str(document_id)}},
            ]
        }
    }

    with create_es_client() as client:
        if not client.indices.exists(index=index_name):
            return 0

        try:
            ensure_chunk_index(client, index_name)
        except ValueError as exc:
            raise SearchIndexError(
                "索引配置不兼容，无法确认清理范围"
            ) from exc

        # 让此前可能部分写入但尚未刷新的分块也能被查询删除。
        client.indices.refresh(index=index_name)

        result = client.delete_by_query(
            index=index_name,
            query=query,
            conflicts="abort",
            refresh=True,
            wait_for_completion=True,
        )

        if (
            result.get("timed_out")
            or result.get("failures")
            or result.get("version_conflicts", 0)
        ):
            raise SearchIndexError("文献搜索分块清理未完成")

        remaining = client.count(
            index=index_name,
            query=query,
        )["count"]

        if remaining != 0:
            raise SearchIndexError("清理后仍存在文献搜索分块")

        deleted_count = result.get("deleted", 0)

    logger.info(
        "文献搜索分块清理完成，user_id=%s，document_id=%s，deleted=%s",
        user_id,
        document_id,
        deleted_count,
    )
    return deleted_count