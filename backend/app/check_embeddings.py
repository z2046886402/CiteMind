"""使用固定测试文本检查向量服务连接，不读取真实文献。"""

import logging

from exceptions.embedding import EmbeddingServiceError
from service.embedding_service import (
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    generate_embeddings,
)

logger = logging.getLogger(__name__)


def main() -> int:
    """调用一次小批量向量请求，检查结果并输出简要信息。"""
    texts = [
        "本文研究利用深度学习识别鱼类摄食行为。",
        "文献检索系统通过向量相似度查找相关段落。",
    ]

    try:
        vectors = generate_embeddings(texts)
    except (ValueError, EmbeddingServiceError) as exc:
        logger.error("向量服务检查失败：%s", exc)
        return 1

    if len(vectors) != len(texts):
        logger.error("向量数量与测试文本数量不一致")
        return 1

    print(f"模型：{EMBEDDING_MODEL}")
    print(f"文本数量：{len(texts)}")
    print(f"向量数量：{len(vectors)}")
    print(f"向量维度：{EMBEDDING_DIMENSIONS}")
    print(f"第一条向量的前 5 个值：{vectors[0][:5]}")
    print("向量服务检查通过")
    return 0


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    raise SystemExit(main())