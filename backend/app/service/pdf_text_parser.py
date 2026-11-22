"""提取 PDF 正文和基础表格，并转换为统一文档结构。

表格识别依赖 PDF 中的线条和文字层，不执行 OCR。
正文与表格统一组织为全文，字符位置对应本次解析结果。
"""

import logging
import re
from bisect import bisect_right
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import pdfplumber
from pdfplumber.page import Page
from pdfplumber.table import Table
from pdfplumber.utils import extract_text

from exceptions.document import DocumentParseError
from schemas.parsed_document import (
    BlockBoundingBox,
    BlockPosition,
    ParsedBlock,
    ParsedDocument,
    ParsedPage,
)


logger = logging.getLogger(__name__)

PARAGRAPH_BREAK = re.compile(r"(?:\r?\n[ \t]*){2,}")

MAX_PDF_TEXT_BLOCKS = 10_000
MAX_TABLES_PER_PAGE = 20
MAX_TABLE_CELLS = 2_000

BoundingBox = tuple[float, float, float, float]


@dataclass
class _PagePiece:
    """保存页面内部的中间解析结果，尚未分配全文字符位置。"""

    kind: Literal["paragraph", "table"]
    text: str
    rows: list[list[str | None]] | None = None
    bbox: BlockBoundingBox | None = None


def _inside(
    x: float,
    y: float,
    box: BoundingBox,
) -> bool:
    """判断点是否位于区域内，与表格提取使用相同的边界规则。"""
    return (
        box[0] <= x < box[2]
        and box[1] <= y < box[3]
    )


def _overlaps(
    first: BoundingBox,
    second: BoundingBox,
) -> bool:
    """判断两个区域是否存在具有面积的交集。"""
    return (
        max(first[0], second[0])
        < min(first[2], second[2])
        and max(first[1], second[1])
        < min(first[3], second[3])
    )


def _table_candidates(
    page: Page,
    page_number: int,
) -> tuple[list[tuple[Table, _PagePiece]], list[str]]:
    """提取可接受的表格；失败候选的文字继续保留在普通正文中。"""
    warnings: list[str] = []

    try:
        detected = page.find_tables(
            table_settings={
                "vertical_strategy": "lines",
                "horizontal_strategy": "lines",
            }
        )
    except Exception as exc:
        # 仅记录页码与异常类型，避免将文献内容写入日志。
        logger.warning(
            "PDF 表格检测失败，page=%s，error_type=%s",
            page_number,
            type(exc).__name__,
        )
        return [], [
            f"第 {page_number} 页表格检测失败，"
            "已按普通文本保留可读取内容"
        ]

    detected = sorted(
        detected,
        key=lambda table: (
            table.bbox[1],
            table.bbox[0],
        ),
    )

    if len(detected) > MAX_TABLES_PER_PAGE:
        warnings.append(
            f"第 {page_number} 页表格候选超过 "
            f"{MAX_TABLES_PER_PAGE} 个，"
            "其余候选按普通文本处理"
        )

    accepted: list[tuple[Table, _PagePiece]] = []
    skipped = 0

    for table in detected[:MAX_TABLES_PER_PAGE]:
        try:
            if len(table.cells) > MAX_TABLE_CELLS:
                skipped += 1
                continue

            # 重叠候选可能重复覆盖同一区域，只接受其中一个。
            if any(
                _overlaps(table.bbox, source.bbox)
                for source, _ in accepted
            ):
                skipped += 1
                continue

            rows = table.extract()

            # 当前只将至少两行、两列的候选作为表格。
            if (
                len(rows) < 2
                or max(
                    (len(row) for row in rows),
                    default=0,
                ) < 2
            ):
                continue

            rows = [
                [
                    cell.strip() if cell is not None else None
                    for cell in row
                ]
                for row in rows
            ]

            # 表格仍需提供普通文本，供现有分块和检索流程使用。
            text = "\n".join(
                "\t".join(cell or "" for cell in row)
                for row in rows
            ).strip()

            if not text:
                continue

            # PDF 页面可能具有非零原点，转换为统一页面局部坐标。
            origin_x, origin_top = page.bbox[:2]

            bbox = BlockBoundingBox(
                x0=float(table.bbox[0] - origin_x),
                top=float(table.bbox[1] - origin_top),
                x1=float(table.bbox[2] - origin_x),
                bottom=float(table.bbox[3] - origin_top),
            )

            if (
                bbox.x1 > page.width
                or bbox.bottom > page.height
            ):
                raise ValueError("表格区域超出页面范围")

            accepted.append(
                (
                    table,
                    _PagePiece(
                        kind="table",
                        text=text,
                        rows=rows,
                        bbox=bbox,
                    ),
                )
            )

        except Exception as exc:
            skipped += 1
            logger.warning(
                "PDF 表格提取失败，page=%s，error_type=%s",
                page_number,
                type(exc).__name__,
            )

    if skipped:
        warnings.append(
            f"第 {page_number} 页有 {skipped} 个表格候选"
            "未转换为结构化表格，相关文字按普通正文保留"
        )

    return accepted, warnings


def _page_pieces(
    page: Page,
    page_number: int,
) -> tuple[list[_PagePiece], list[str]]:
    """按几何位置分离正文与表格，避免表格文字重复进入全文。

    当前采用基础的自上而下排序，不恢复复杂双栏阅读顺序，
    也不合并跨页表格。
    """
    tables, warnings = _table_candidates(
        page,
        page_number,
    )

    if not tables:
        return [
            _PagePiece(
                kind="paragraph",
                text=page.extract_text() or "",
            )
        ], warnings

    table_tops = [
        source.bbox[1]
        for source, _ in tables
    ]

    # N 个表格对应 N+1 个正文区间，表格侧边的正文也会保留。
    buckets = [
        []
        for _ in range(len(tables) + 1)
    ]

    for character in page.chars:
        center_x = (
            character["x0"] + character["x1"]
        ) / 2
        center_y = (
            character["top"] + character["bottom"]
        ) / 2

        # 使用字符所在单元格判断归属，不能用字符串替换去重，
        # 否则正文中恰好相同的词语也可能被误删。
        captured = any(
            _inside(center_x, center_y, source.bbox)
            and any(
                _inside(center_x, center_y, cell)
                for cell in source.cells
                if cell is not None
            )
            for source, _ in tables
        )

        if not captured:
            bucket_index = bisect_right(
                table_tops,
                center_y,
            )
            buckets[bucket_index].append(character)

    pieces: list[_PagePiece] = []

    for index, characters in enumerate(buckets):
        if characters:
            pieces.append(
                _PagePiece(
                    kind="paragraph",
                    text=extract_text(characters) or "",
                )
            )

        if index < len(tables):
            pieces.append(tables[index][1])

    return pieces, warnings


def parse_pdf_text(
    path: Path,
    *,
    max_pages: int,
    max_characters: int,
) -> ParsedDocument:
    """解析 PDF 正文和表格，并生成与全文一致的字符位置。

    Args:
        path: 已由业务层校验的文件路径。
        max_pages: 允许同步解析的最大页数。
        max_characters: 组织后的全文字符数量上限。

    Returns:
        包含真实页码、正文块、表格行列和表格坐标的解析结果。

    Raises:
        DocumentParseError: 页面、字符或解析块数量超过限制。
    """
    parts: list[str] = []
    pages: list[ParsedPage] = []
    blocks: list[ParsedBlock] = []
    warnings: list[str] = []
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
                pages.append(
                    ParsedPage(
                        page_number=page_number,
                        width=float(page.width),
                        height=float(page.height),
                    )
                )

                pieces, page_warnings = _page_pieces(
                    page,
                    page_number,
                )
                warnings.extend(page_warnings)
                page_has_text = False

                for piece in pieces:
                    # 表格作为完整解析块保留；正文继续按空行拆分。
                    fragments = (
                        PARAGRAPH_BREAK.split(piece.text)
                        if piece.kind == "paragraph"
                        else [piece.text]
                    )

                    for fragment in fragments:
                        block_text = fragment.strip()

                        if not block_text:
                            continue

                        if len(blocks) >= MAX_PDF_TEXT_BLOCKS:
                            raise DocumentParseError(
                                "PDF 解析块超过当前 "
                                "10000 块的处理限制"
                            )

                        # 全文统一使用两个换行分隔，并同步计算位置。
                        start_char = character_count + (
                            2 if parts else 0
                        )
                        end_char = start_char + len(block_text)

                        if end_char > max_characters:
                            raise DocumentParseError(
                                f"提取文本超过当前 "
                                f"{max_characters} 字符限制"
                            )

                        blocks.append(
                            ParsedBlock(
                                block_index=len(blocks) + 1,
                                kind=piece.kind,
                                text=block_text,
                                start_char=start_char,
                                end_char=end_char,
                                positions=[
                                    BlockPosition(
                                        page_number=page_number,
                                        bbox=piece.bbox,
                                    )
                                ],
                                table_rows=piece.rows,
                            )
                        )

                        parts.append(block_text)
                        character_count = end_char
                        page_has_text = True

                if not page_has_text:
                    empty_pages.append(page_number)

            finally:
                page.close()

    if empty_pages:
        page_numbers = "、".join(map(str, empty_pages))
        warnings.append(
            f"第 {page_numbers} 页未提取到文字，"
            "可能为空白页或需要 OCR"
        )

    return ParsedDocument(
        format="pdf",
        parser_name="pdfplumber_tables_v1",
        content="\n\n".join(parts),
        page_count=page_count,
        pages=pages,
        blocks=blocks,
        warnings=warnings,
    )