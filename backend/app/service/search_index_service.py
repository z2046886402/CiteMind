"""定义并检查文献分块搜索索引。"""

import logging
from typing import Any

from elasticsearch import BadRequestError, Elasticsearch

from service.embedding_service import (
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
)
from service.text_chunker import TOKENIZER_NAME

logger = logging.getLogger(__name__)

INDEX_SCHEMA_VERSION = 1

# 沿用原项目的向量字段命名方式。
VECTOR_FIELD = f"q_{EMBEDDING_DIMENSIONS}_vec"


def build_chunk_mapping() -> dict[str, Any]:
    """构建显式映射，防止首次写入时自动推断出错误字段类型。"""
    properties: dict[str, Any] = {}

    for name in (
        "user_id",
        "doc_id",
        "docnm_kwd",
        "tokenizer",
        "embedding_model",
    ):
        properties[name] = {"type": "keyword"}

    for name in (
        "chunk_index",
        "token_count",
        "start_char",
        "end_char",
        "start_token",
        "end_token",
        "chunk_size",
        "chunk_overlap",
    ):
        properties[name] = {"type": "integer"}

    properties["content_with_weight"] = {
        "type": "text",
        "analyzer": "standard",
    }

    properties["created_at"] = {"type": "date"}

    properties[VECTOR_FIELD] = {
        "type": "dense_vector",
        "dims": EMBEDDING_DIMENSIONS,
        "element_type": "float",
        "index": True,
        "similarity": "cosine",
        "index_options": {"type": "hnsw"},
    }

    return {
        "dynamic": "strict",
        "_meta": {
            "schema_version": INDEX_SCHEMA_VERSION,
            "embedding_model": EMBEDDING_MODEL,
            "embedding_dimensions": EMBEDDING_DIMENSIONS,
            "tokenizer": TOKENIZER_NAME,
        },
        "properties": properties,
    }


def _contains_expected(actual: Any, expected: Any) -> bool:
    """检查实际配置是否包含全部预期设置。

    Elasticsearch 可能补充默认参数，因此允许实际字典包含额外字段，
    但所有显式要求的配置必须一致。
    """
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(
            key in actual and _contains_expected(actual[key], value)
            for key, value in expected.items()
        )

    return actual == expected

def ensure_chunk_index(
    client: Elasticsearch,
    index_name: str,
) -> bool:
    """创建缺失的索引，并检查已有映射是否兼容。

    Args:
        client: 已配置认证信息的 Elasticsearch 客户端。
        index_name: 已校验的具体索引名称。

    Returns:
        本次成功创建索引时为 True，复用已有索引时为 False。

    Raises:
        ValueError: 已有映射或模型元信息与当前配置不兼容。
        ApiError: Elasticsearch 请求失败。

    Notes:
        不删除索引，也不自动修改已有字段。
        发现不兼容时停止，由后续迁移流程处理。
    """
    expected = build_chunk_mapping()
    created = False

    if not client.indices.exists(index=index_name):
        try:
            client.indices.create(
                index=index_name,
                settings={
                    "number_of_shards": 1,
                    "number_of_replicas": 0,
                },
                mappings=expected,
            )
            created = True
        except BadRequestError as exc:
            # 允许两个初始化进程同时运行，仍继续校验实际映射。
            if exc.error != "resource_already_exists_exception":
                raise

    actual = client.indices.get_mapping(
        index=index_name,
    )[index_name]["mappings"]

    if actual.get("dynamic") != expected["dynamic"]:
        raise ValueError("已有索引的动态映射策略不兼容")

    if actual.get("_meta") != expected["_meta"]:
        raise ValueError("已有索引的模型或结构版本不兼容")

    actual_properties = actual.get("properties", {})

    for field_name, definition in expected["properties"].items():
        actual_definition = dict(
        actual_properties.get(field_name, {})
        )

        if actual_definition.get("type") == "dense_vector":
            # 服务端可能省略默认浮点类型，比较前补齐其实际语义。
            actual_definition.setdefault("element_type", "float")

        if not _contains_expected(actual_definition, definition):
            raise ValueError(
                f"已有索引字段配置不兼容：{field_name}"
            )

    logger.info(
        "文献分块索引检查通过，index=%s，created=%s，dimensions=%s",
        index_name,
        created,
        EMBEDDING_DIMENSIONS,
    )
    return created