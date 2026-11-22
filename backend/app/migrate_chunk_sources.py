"""为现有 Elasticsearch 索引增加分块来源字段。"""

import logging

from elastic_transport import TransportError
from elasticsearch import ApiError

from service.search_index_service import (
    upgrade_chunk_source_mapping,
)
from utils.es_client import (
    create_es_client,
    get_chunk_index_name,
)


logger = logging.getLogger(__name__)


def main() -> int:
    """执行增量映射迁移，返回进程退出码。"""
    try:
        index_name = get_chunk_index_name()

        with create_es_client() as client:
            upgrade_chunk_source_mapping(
                client,
                index_name,
            )

        print(f"分块来源字段迁移完成：{index_name}")
        print("已有分块的来源信息将在重新建立文献索引后补齐")
        return 0

    except ValueError as exc:
        logger.error("配置或映射检查失败：%s", exc)
        return 1

    except (ApiError, TransportError) as exc:
        # 不输出认证配置或完整服务端响应。
        logger.error(
            "映射迁移失败，error_type=%s，status_code=%s",
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