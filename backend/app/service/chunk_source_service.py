"""根据分块与解析块的字符交集，补充分块来源信息。"""

from bisect import bisect_right

from schemas.document import DocumentChunkItem
from schemas.parsed_document import ParsedBlock


def attach_chunk_sources(
    chunks: list[DocumentChunkItem],
    blocks: list[ParsedBlock],
) -> list[DocumentChunkItem]:
    """为分块补充页码和表格标识，不改变正文及字符、Token 位置。

    Args:
        chunks: 按原文顺序生成的分块。
        blocks: 已由解析器校验、按字符位置排列的解析块。

    Returns:
        带来源信息的新分块列表，不修改传入对象。

    Notes:
        只统计具有非空白文字交集的解析块。
        页码来自解析块的位置，不根据字符数量估算。
        当前元数据描述整个分块，不提供逐句或逐字符定位。
    """
    block_ends = [
        block.end_char
        for block in blocks
    ]

    result: list[DocumentChunkItem] = []

    for chunk in chunks:
        # 跳过已经在当前分块之前结束的解析块。
        index = bisect_right(
            block_ends,
            chunk.start_char,
        )

        page_numbers: set[int] = set()
        contains_table = False
        matched = False

        while (
            index < len(blocks)
            and blocks[index].start_char < chunk.end_char
        ):
            block = blocks[index]

            left = max(chunk.start_char, block.start_char)
            right = min(chunk.end_char, block.end_char)

            fragment = block.text[
                left - block.start_char:
                right - block.start_char
            ]

            # 只有分隔换行相交时，不把该解析块算作内容来源。
            if fragment.strip():
                matched = True
                contains_table = (
                    contains_table
                    or block.kind == "table"
                )

                page_numbers.update(
                    position.page_number
                    for position in block.positions
                )

            index += 1

        result.append(
            chunk.model_copy(
                update={
                    "page_numbers": sorted(page_numbers),
                    "contains_table": (
                        contains_table if matched else None
                    ),
                }
            )
        )

    return result