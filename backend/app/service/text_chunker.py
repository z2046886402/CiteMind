"""在 Token 上限内优先按段落和句末分块，保留原文位置及重叠。"""

import logging
import os
from functools import lru_cache
from pathlib import Path

import tiktoken

from schemas.document import DocumentChunkItem

import re
from bisect import bisect_left, bisect_right

logger = logging.getLogger(__name__)

TOKENIZER_NAME = "cl100k_base"
MAX_CHUNKS = 5000

# 按优先级排列：段落、句末、普通换行。
# 普通换行优先级较低，因为 PDF 中换行经常只是排版产生的。
BOUNDARY_PATTERNS = (
    re.compile(r"(?:\r?\n[ \t]*){2,}"),
    re.compile(
        r"""[。！？!?；;]+[”’"'）)\]】》]*|\.[”’"'）)\]】》]*(?=\s|$)"""
    ),
    re.compile(r"\r?\n"),
)


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


def _collect_split_points(
    text: str,
    pattern: re.Pattern[str],
    character_boundaries: list[int],
    token_boundaries: list[int],
) -> list[int]:
    """将文本结构边界映射为可安全切分的 Token 位置。

    正则匹配得到的是字符位置，而分块上限使用 Token 位置。
    两者不一定恰好重合，因此允许边界向右包含少量空白，
    但不能跨过正文字符，也不能切开 UTF-8 字符。
    """
    points: set[int] = set()

    for match in pattern.finditer(text):
        position = bisect_left(
            character_boundaries,
            match.end(),
        )

        if position >= len(character_boundaries):
            continue

        character_end = character_boundaries[position]

        # 若向右对齐必须跨过正文，则放弃这个结构边界。
        if text[match.end():character_end].strip():
            continue

        points.add(token_boundaries[position])

    return sorted(points)


def _choose_chunk_end(
    start: int,
    hard_end: int,
    chunk_size: int,
    chunk_overlap: int,
    previous_end: int,
    boundary_groups: list[list[int]],
) -> int:
    """在 Token 上限内，优先选择段落或句末作为分块结束位置。

    只在窗口后半段寻找，避免产生大量过短分块。
    新结束位置必须超过上一块结尾，保证重叠时仍持续向前推进。
    没有合适结构边界时，返回已经对齐字符边界的 hard_end。
    """
    minimum_end = max(
        start + chunk_size // 2,
        start + chunk_overlap + 1,
        previous_end + 1,
    )

    for points in boundary_groups:
        # 找到这一类边界中，不超过当前 Token 上限的最后一个。
        position = bisect_right(points, hard_end) - 1

        if position >= 0 and points[position] >= minimum_end:
            return points[position]

    return hard_end


def _collect_table_intervals(
    text: str,
    table_ranges: list[tuple[int, int]],
    character_boundaries: list[int],
    token_boundaries: list[int],
    chunk_size: int,
) -> list[tuple[int, int]]:
    """将表格字符范围转换为需要保护的 Token 区间。

    表格边缘可能落在某个 Token 内部，因此向外对齐到同时满足
    Token 边界和完整字符边界的位置，避免破坏表格文字。

    对齐后重叠的区间合并处理；超过分块上限的区间不进行
    完整性保护，继续交给普通文本分块逻辑处理。
    """
    intervals: list[tuple[int, int]] = []
    previous_end = 0

    for start_char, end_char in sorted(table_ranges):
        if not 0 <= start_char < end_char <= len(text):
            raise ValueError("表格字符范围无效或超出全文")

        if start_char < previous_end:
            raise ValueError("表格字符范围不能重叠")

        previous_end = end_char

        # 起点向左、终点向右对齐，确保区间覆盖完整表格。
        left = bisect_right(
            character_boundaries,
            start_char,
        ) - 1

        right = bisect_left(
            character_boundaries,
            end_char,
        )

        start_token = token_boundaries[left]
        end_token = token_boundaries[right]

        # 原始范围不重叠，但向外对齐后可能覆盖同一个 Token。
        if intervals and start_token < intervals[-1][1]:
            intervals[-1] = (
                intervals[-1][0],
                max(intervals[-1][1], end_token),
            )
        else:
            intervals.append((start_token, end_token))

    protected = [
        interval
        for interval in intervals
        if interval[1] - interval[0] <= chunk_size
    ]

    if len(protected) < len(intervals):
        logger.info(
            "超出 Token 上限的表格区域按普通文本分块，regions=%s",
            len(intervals) - len(protected),
        )

    return protected


def split_text(
    text: str,
    chunk_size: int,
    chunk_overlap: int,
    *,
    table_ranges: list[tuple[int, int]] | None = None,
) -> list[DocumentChunkItem]:
    """在 Token 上限内，优先选择段落和句末边界生成重叠分块。

    Args:
        text: 完整的解析后文本，不进行额外裁剪或空白替换。
        chunk_size: 原文 Token 流中每块的覆盖数量上限。
        chunk_overlap: 相邻窗口的目标重叠数量。
        table_ranges: 表格在全文中的字符范围，采用左闭右开区间。

    Returns:
        按原文顺序排列、从 1 开始编号的分块列表。

    Raises:
        ValueError: 参数无效、分块数量超限或无法确定字符边界。
        RuntimeError: 编码器初始化失败。

    Notes:
        优先在窗口后半段寻找段落、句末和换行边界。
        无合适边界或句子过长时，按 Token 上限切分。
        Token 边界可能位于中文字符内部，因此仍需对齐完整字符。
        重叠区的开头可能位于句子内部，实际重叠量可能略小于目标值。
        分隔符仅作为结构提示，本函数不执行语义理解。
        能放入单块的表格保持完整，必要时减少重叠。
        超过上限的表格继续按普通文本规则分块。
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

    # 两个有序列表逐项对应：Token 边界位置和原文字符位置。
    valid_token_boundaries = sorted(valid_boundaries)

    valid_character_boundaries = [
        byte_to_char[token_offsets[index]]
        for index in valid_token_boundaries
    ]

    # 全文只扫描一次各类分隔符，后续分块通过二分查找选择边界。
    boundary_groups = [
        _collect_split_points(
            text,
            pattern,
            valid_character_boundaries,
            valid_token_boundaries,
        )
        for pattern in BOUNDARY_PATTERNS
    ]

    # 使用全文的统一 Token 流定位表格，保持现有偏移量的含义。
    table_intervals = _collect_table_intervals(
        text=text,
        table_ranges=table_ranges or [],
        character_boundaries=valid_character_boundaries,
        token_boundaries=valid_token_boundaries,
        chunk_size=chunk_size,
    )

    table_starts = [
        interval[0]
        for interval in table_intervals
    ]

    table_edges = {
        position
        for interval in table_intervals
        for position in interval
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
        # 剩余文本能够全部放入当前块时直接收尾，
        # 避免为了最后一小段额外增加分块。
        # 保存按长度上限计算出的安全边界，表格调整不能越过它。
        hard_end = end
        if end < len(tokens):
            end = _choose_chunk_end(
                start=start,
                hard_end=end,
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
                previous_end=(
                    chunks[-1].end_token
                    if chunks
                    else 0
                ),
                boundary_groups=boundary_groups,
            )
        # 如果结束位置落在受保护表格内部，尝试包含整张表格；
        # 当前窗口装不下时，在表格之前结束，留给下一块处理。
        table_position = bisect_right(
            table_starts,
            end,
        ) - 1

        if table_position >= 0:
            table_start, table_end = table_intervals[
                table_position
            ]

            if table_start < end < table_end:
                end = (
                    table_end
                    if table_end <= hard_end
                    else table_start
                )
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

        if end in table_edges:
            # 在表格边界结束时取消本次重叠，避免下一窗口因
            # 重叠占用容量而无法装下表格，或再次落入表格内部。
            next_start = end
        else:
            table_position = bisect_right(
                table_starts,
                next_start,
            ) - 1

            if table_position >= 0:
                table_start, table_end = table_intervals[
                    table_position
                ]

                if table_start < next_start < table_end:
                    # 表格已完整包含在上一块中，下一块从表格后开始。
                    next_start = table_end

        start = next_start

    return chunks
