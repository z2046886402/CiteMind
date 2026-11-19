
"""通过阿里云 OpenAI 兼容接口批量生成文本向量。"""

import logging
import math
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import (
    APIError,
    AuthenticationError,
    OpenAI,
    PermissionDeniedError,
)

from exceptions.embedding import EmbeddingServiceError

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-v3"
EMBEDDING_DIMENSIONS = 1024
EMBEDDING_BATCH_SIZE = 10


def _load_settings() -> tuple[str, str]:
    """读取后端配置，不在日志或异常中输出密钥。"""
    env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(env_path)

    api_key = os.getenv("DASHSCOPE_API_KEY", "").strip()
    base_url = os.getenv("DASHSCOPE_BASE_URL", "").strip()

    if not api_key:
        raise EmbeddingServiceError("未配置 DASHSCOPE_API_KEY")

    if not base_url:
        raise EmbeddingServiceError("未配置 DASHSCOPE_BASE_URL")

    return api_key, base_url


def generate_embeddings(texts: list[str]) -> list[list[float]]:
    """批量生成向量，返回顺序与输入文本顺序一致。

    Args:
        texts: 非空文本列表，每项对应一个待向量化的文本片段。

    Returns:
        与输入一一对应的 1024 维浮点向量列表。

    Raises:
        ValueError: 输入为空或包含无效文本。
        EmbeddingServiceError: 配置、模型调用或响应校验失败。

    Notes:
        任一批次失败时抛出异常，不返回包含空向量的部分成功结果。
        已完成的远程调用无法通过本地异常回滚。
    """
    if not texts:
        raise ValueError("待向量化文本列表不能为空")

    if any(not isinstance(text, str) or not text.strip() for text in texts):
        raise ValueError("待向量化内容必须是非空字符串")

    api_key, base_url = _load_settings()
    vectors: list[list[float]] = []

    try:
        # 使用上下文管理关闭网络资源；当前关闭自动重试，便于排查调用。
        with OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=60.0,
            max_retries=0,
        ) as client:
            for offset in range(0, len(texts), EMBEDDING_BATCH_SIZE):
                batch = texts[offset:offset + EMBEDDING_BATCH_SIZE]

                response = client.embeddings.create(
                    model=EMBEDDING_MODEL,
                    input=batch,
                    dimensions=EMBEDDING_DIMENSIONS,
                    encoding_format="float",
                )

                # 按响应索引恢复顺序，避免向量与输入文本错位。
                items = sorted(response.data, key=lambda item: item.index)
                expected_indices = list(range(len(batch)))

                if [item.index for item in items] != expected_indices:
                    raise EmbeddingServiceError("向量响应数量或索引不正确")

                for item in items:
                    vector = item.embedding

                    if len(vector) != EMBEDDING_DIMENSIONS:
                        raise EmbeddingServiceError("向量维度与配置不一致")

                    if not all(math.isfinite(value) for value in vector):
                        raise EmbeddingServiceError("向量包含无效数值")

                    if not any(value != 0 for value in vector):
                        raise EmbeddingServiceError("向量服务返回了全零向量")

                    vectors.append(vector)

                logger.info(
                    "向量批次完成，batch=%s，texts=%s，dimensions=%s",
                    offset // EMBEDDING_BATCH_SIZE + 1,
                    len(batch),
                    EMBEDDING_DIMENSIONS,
                )
    except (AuthenticationError, PermissionDeniedError) as exc:
        raise EmbeddingServiceError(
            "向量服务认证或授权失败，请检查 API Key、地域和模型权限"
        ) from exc
    except APIError as exc:
        # 不记录远程响应正文，避免意外包含输入文本或凭证信息。
        logger.error(
            "向量服务请求失败，error_type=%s，status_code=%s",
            type(exc).__name__,
            getattr(exc, "status_code", None),
        )
        raise EmbeddingServiceError(
            "向量服务调用失败，请检查地址、网络、额度或服务限流"
        ) from exc

    return vectors