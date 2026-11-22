"""将 PDF 文字层转换为统一解析结构，保留真实页码和全文位置。"""

import re
from collections.abc import Iterator
from pathlib import Path

import pdfplumber

from exceptions.document import DocumentParseError
from schemas.parsed_document import (
    BlockPosition,
    ParsedBlock,
    ParsedDocument,
    ParsedPage,
)


PARAGRAPH_BREAK = re.compile(r"(?:\r?\n[ \t]*){2,}")

# 限制同步解析产生的结构数量，避免大量细碎块占用过多资源。
MAX_PDF_TEXT_BLOCKS = 10_000


def _paragraph_ranges(text: str) -> Iterator[tuple[int, int]]:
    """按空行返回候选段落范围，不改变原文中的字符位置。"""
    start = 0

    for match in PARAGRAPH_BREAK.finditer(text):
        yield start, match.start()
        start = match.end()

    yield start, len(text)


def parse_pdf_text(
    path: Path,
    *,
    max_pages: int,
    max_characters: int,
) -> ParsedDocument:
    """提取 PDF 文字层并生成统一结构。

    Args:
        path: 已由业务层校验的本机文件路径。
        max_pages: 本次同步解析允许的最大页数。
        max_characters: 合并全文允许的最大字符数。

    Returns:
        包含页面尺寸、候选正文块和字符位置的解析结果。

    Notes:
        全文沿用逐页去除首尾空白、以双换行拼接的规则。
        空白页保留页面信息，但不生成空白文本块。
        当前依据空行生成候选正文块，不判断真实段落或表格。
        未提取区域坐标时，bbox 保留为 None。
    """
    parts: list[str] = []
    pages: list[ParsedPage] = []
    blocks: list[ParsedBlock] = []
    empty_pages: list[int] = []

    character_count = 0

    with pdfplumber.open(path) as document:
        page_count = len(document.pages)

        if page_count == 0:
            raise DocumentParseError("PDF 没有可读取的页面")

        if page_count > max_pages:
            raise DocumentParseError(
                f"当前同步解析最多支持 {max_pages} 页 PDF"
            )

        for page_number, page in enumerate(
            document.pages,
            start=1,
        ):
            try:
                # 在判断文字是否为空之前记录页面，保留实际页码。
                pages.append(
                    ParsedPage(
                        page_number=page_number,
                        width=float(page.width),
                        height=float(page.height),
                    )
                )

                page_text = (page.extract_text() or "").strip()

                if not page_text:
                    empty_pages.append(page_number)
                    continue

                page_start = character_count + (2 if parts else 0)
                new_count = page_start + len(page_text)

                if new_count > max_characters:
                    raise DocumentParseError(
                        f"提取文本超过当前 {max_characters} 字符限制"
                    )

                for local_start, local_end in _paragraph_ranges(
                    page_text
                ):
                    fragment = page_text[local_start:local_end]
                    block_text = fragment.strip()

                    if not block_text:
                        continue

                    if len(blocks) >= MAX_PDF_TEXT_BLOCKS:
                        raise DocumentParseError(
                            "PDF 文本块超过当前 10000 块的处理限制"
                        )

                    # 去除块首尾空白后，同步修正其在全文中的位置。
                    leading = len(fragment) - len(fragment.lstrip())
                    start_char = page_start + local_start + leading

                    blocks.append(
                        ParsedBlock(
                            block_index=len(blocks) + 1,
                            kind="paragraph",
                            text=block_text,
                            start_char=start_char,
                            end_char=start_char + len(block_text),
                            positions=[
                                BlockPosition(
                                    page_number=page_number,
                                )
                            ],
                        )
                    )

                parts.append(page_text)
                character_count = new_count

            finally:
                page.close()

    warnings: list[str] = []

    if empty_pages:
        page_numbers = "、".join(map(str, empty_pages))
        warnings.append(
            f"第 {page_numbers} 页未提取到文字，"
            "可能为空白页或需要 OCR"
        )

    return ParsedDocument(
        format="pdf",
        parser_name="pdfplumber_text_v1",
        content="\n\n".join(parts),
        page_count=page_count,
        pages=pages,
        blocks=blocks,
        warnings=warnings,
    )