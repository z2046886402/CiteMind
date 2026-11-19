"""检查 Elasticsearch 连接，并初始化文献分块索引。"""

import logging

from elastic_transport import TransportError
from elasticsearch import ApiError

from service.embedding_service import EMBEDDING_DIMENSIONS
from service.search_index_service import VECTOR_FIELD, ensure_chunk_index
from utils.es_client import create_es_client, get_chunk_index_name

logger = logging.getLogger(__name__)


def main() -> int:
    """验证连接和版本，创建或复查索引，返回进程退出码。"""
    try:
        index_name = get_chunk_index_name()

        with create_es_client() as client:
            info = client.info()
            server_version = info["version"]["number"]

            if server_version.split(".")[0] != "9":
                raise ValueError("当前客户端配置要求 Elasticsearch 9.x")

            created = ensure_chunk_index(client, index_name)
            document_count = client.count(index=index_name)["count"]

        print(f"Elasticsearch 版本：{server_version}")
        print(f"索引名称：{index_name}")
        print(f"索引状态：{'已创建' if created else '已存在且配置兼容'}")
        print(f"向量字段：{VECTOR_FIELD}")
        print(f"向量维度：{EMBEDDING_DIMENSIONS}")
        print(f"当前分块数量：{document_count}")
        print("搜索索引初始化完成")
        return 0
    except ValueError as exc:
        logger.error("配置或映射检查失败：%s", exc)
        return 1
    except (ApiError, TransportError) as exc:
        # 不输出认证配置或完整服务端响应。
        logger.error(
            "Elasticsearch 请求失败，error_type=%s，status_code=%s",
            type(exc).__name__,
            getattr(exc, "status_code", None),
        )
        return 1


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    raise SystemExit(main())