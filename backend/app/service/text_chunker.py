"""基于 Token 窗口切分文本，并保持完整的 UTF-8 字符边界。"""

import logging
import os
from functools import lru_cache
from pathlib import Path

import tiktoken

from schemas.document import DocumentChunkItem

logger = logging.getLogger(__name__)

TOKENIZER_NAME = "cl100k_base"
MAX_CHUNKS = 5000


@lru_cache(maxsize=1)
def _get_encoder() -> tiktoken.Encoding:
    """加载并复用编码器，将词表缓存放在后端缓存目录。"""
    try:
        cache_dir = Path(__file__).resolve().parents[2] / ".cache" / "tiktoken"
        cache_dir.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("TIKTOKEN_CACHE_DIR", str(cache_dir))
        return tiktoken.get_encoding(TOKENIZER_NAME)
    except Exception as exc:
        logger.exception("Token 编码器初始化失败")
        raise RuntimeError("Token 编码器初始化失败，请检查词表缓存或网络") from exc


def split_text(
    text: str,
    chunk_size: int,
    chunk_overlap: int,
) -> list[DocumentChunkItem]:
    """将文本切成有重叠的 Token 窗口。

    Args:
        text: 完整的解析后文本，不进行额外裁剪或空白替换。
        chunk_size: 原文 Token 流中每块的覆盖数量上限。
        chunk_overlap: 相邻窗口的目标重叠数量。

    Returns:
        按原文顺序排列、从 1 开始编号的分块列表。

    Raises:
        ValueError: 参数无效、分块数量超限或无法确定字符边界。
        RuntimeError: 编码器初始化失败。

    Notes:
        Token 边界可能位于一个中文字符内部。
        实际窗口会向完整字符边界调整，重叠量可能略小于目标值。
    """
    if not 64 <= chunk_size <= 2048:
        raise ValueError("分块大小必须在 64 至 2048 之间")

    if not 0 <= chunk_overlap <= chunk_size // 2:
        raise ValueError("重叠数量必须在 0 至分块大小的一半之间")

    if not text.strip():
        raise ValueError("待分块文本不能为空")

    encoder = _get_encoder()

    # 文献内容中的特殊标记按普通文本编码，不将其当作控制 Token。
    tokens = encoder.encode(text, disallowed_special=())

    # 建立 UTF-8 字节位置到 Python 字符位置的映射。
    byte_to_char = {0: 0}
    byte_offset = 0

    for character_index, character in enumerate(text, start=1):
        byte_offset += len(character.encode("utf-8"))
        byte_to_char[byte_offset] = character_index

    token_offsets = [0]

    for token in tokens:
        token_offsets.append(
            token_offsets[-1] + len(encoder.decode_single_token_bytes(token))
        )

    # 只有同时位于完整字符边界的 Token 边界，才能作为切分点。
    valid_boundaries = {
        index
        for index, offset in enumerate(token_offsets)
        if offset in byte_to_char
    }

    chunks: list[DocumentChunkItem] = []
    start = 0

    while start < len(tokens):
        if len(chunks) >= MAX_CHUNKS:
            raise ValueError("分块数量超过 5000，请增大分块大小")

        end = min(start + chunk_size, len(tokens))

        while end > start and end not in valid_boundaries:
            end -= 1

        if end <= start:
            raise ValueError("无法确定完整字符边界")

        start_char = byte_to_char[token_offsets[start]]
        end_char = byte_to_char[token_offsets[end]]
        content = text[start_char:end_char]

        chunks.append(
            DocumentChunkItem(
                chunk_index=len(chunks) + 1,
                content=content,
                character_count=len(content),
                token_count=end - start,
                start_char=start_char,
                end_char=end_char,
                start_token=start,
                end_token=end,
            )
        )

        if end == len(tokens):
            break

        # 向前推进并调整到完整字符边界，保证不丢字且不会死循环。
        next_start = max(end - chunk_overlap, start + 1)

        while next_start < end and next_start not in valid_boundaries:
            next_start += 1

        start = next_start

    return chunks