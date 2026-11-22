"""提供 PDF、DOCX、TXT 文件的基础文本提取能力。"""

import logging
from pathlib import Path

import pdfplumber
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

from exceptions.document import DocumentParseError

from schemas.parsed_document import ParsedBlock, ParsedDocument
from service.pdf_text_parser import parse_pdf_text

logger = logging.getLogger(__name__)

# 同步解析阶段的业务限制；后续长文献处理应迁移到后台任务。
MAX_PDF_PAGES = 100
MAX_TEXT_CHARACTERS = 500_000
MAX_SOURCE_BYTES = 20 * 1024 * 1024


def _append_text(
    parts: list[str],
    text: str,
    character_count: int,
) -> int:
    """追加非空文本，并检查合并后的字符数上限。"""
    normalized = text.strip()
    if not normalized:
        return character_count

    separator_length = 2 if parts else 0
    new_count = character_count + separator_length + len(normalized)

    if new_count > MAX_TEXT_CHARACTERS:
        raise DocumentParseError("提取文本超过当前 50 万字符的处理限制")

    parts.append(normalized)
    return new_count


def _parse_pdf(path: Path) -> tuple[str, int, list[str]]:
    """保留原有文本接口，内部复用统一的 PDF 文字层适配器。"""
    result = parse_pdf_text(
        path,
        max_pages=MAX_PDF_PAGES,
        max_characters=MAX_TEXT_CHARACTERS,
    )

    return result.content, len(result.pages), result.warnings


def _parse_docx(path: Path) -> str:
    """按正文顺序提取段落及顶层表格的文本。

    表格转换为以制表符分隔的文本；暂不处理页眉、页脚、
    文本框、图片文字及嵌套表格结构。
    """
    document = Document(str(path))
    parts: list[str] = []
    character_count = 0

    for block in document.iter_inner_content():
        if isinstance(block, Paragraph):
            character_count = _append_text(
                parts,
                block.text,
                character_count,
            )
        elif isinstance(block, Table):
            for row in block.rows:
                row_text = "\t".join(cell.text for cell in row.cells)
                character_count = _append_text(
                    parts,
                    row_text,
                    character_count,
                )

    return "\n\n".join(parts)


def _parse_txt(path: Path) -> str:
    """读取 UTF-8、带 BOM 的 UTF-16 或 GB18030 文本。

    不使用忽略解码错误的方式，避免静默丢失字符。
    """
    raw = path.read_bytes()

    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        encodings = ("utf-16",)
    else:
        encodings = ("utf-8-sig", "gb18030")

    for encoding in encodings:
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue

    raise DocumentParseError("无法识别 TXT 编码，请转换为 UTF-8 后重新上传")


def parse_file(path: Path) -> tuple[str, int | None, list[str]]:
    """根据扩展名提取文件文本。

    Args:
        path: 经过业务层校验的服务器本机文件路径。

    Returns:
        文本、PDF 页数及解析提示；非 PDF 的页数为 None。

    Raises:
        DocumentParseError: 内容不可读、没有文本或超过处理限制。
        OSError: 文件不存在或读取失败。
    """
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise DocumentParseError("原文件超过当前 20 MiB 的处理限制")

    try:
        extension = path.suffix.lower()

        if extension == ".pdf":
            content, page_count, warnings = _parse_pdf(path)
        elif extension == ".docx":
            content = _parse_docx(path)
            page_count = None
            warnings = []
        elif extension == ".txt":
            content = _parse_txt(path)
            page_count = None
            warnings = []
        else:
            raise DocumentParseError("不支持该文件格式")
    except (DocumentParseError, OSError):
        raise
    except Exception as exc:
        # 第三方解析库的异常在适配边界统一转换，详细原因保留在日志。
        logger.exception("文件解析器执行失败")
        raise DocumentParseError(
            "文件无法解析，请检查是否损坏、加密或与扩展名不符"
        ) from exc

    content = content.strip()

    if not content:
        raise DocumentParseError(
            "未提取到有效文字；扫描文档需要后续接入 OCR"
        )

    if len(content) > MAX_TEXT_CHARACTERS:
        raise DocumentParseError("提取文本超过当前 50 万字符的处理限制")

    return content, page_count, warnings

def parse_file_structured(path: Path) -> ParsedDocument:
    """根据文件格式返回统一解析结果。

    Args:
        path: 经过业务层归属和存储路径校验的文件。

    Returns:
        PDF 返回真实页面与候选文本块。
        DOCX、TXT 暂时将既有全文包装为一个正文块，页码未知。

    Raises:
        DocumentParseError: 文件无法解析、没有文字或超过业务限制。
        OSError: 文件读取失败。
    """
    extension = path.suffix.lower()

    if extension != ".pdf":
        # 沿用已有格式校验、编码处理和字符数限制。
        content, page_count, warnings = parse_file(path)

        return ParsedDocument(
            format="docx" if extension == ".docx" else "txt",
            parser_name=(
                "python_docx_text_v1"
                if extension == ".docx"
                else "text_decode_v1"
            ),
            content=content,
            page_count=page_count,
            blocks=[
                ParsedBlock(
                    block_index=1,
                    kind="paragraph",
                    text=content,
                    start_char=0,
                    end_char=len(content),
                )
            ],
            warnings=warnings,
        )

    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise DocumentParseError(
            "原文件超过当前 20 MiB 的处理限制"
        )

    try:
        result = parse_pdf_text(
            path,
            max_pages=MAX_PDF_PAGES,
            max_characters=MAX_TEXT_CHARACTERS,
        )
    except (DocumentParseError, OSError):
        raise
    except Exception as exc:
        logger.error(
            "结构化 PDF 解析失败，error_type=%s",
            type(exc).__name__,
        )
        raise DocumentParseError(
            "PDF 无法解析，请检查是否损坏或加密"
        ) from exc

    if not result.content.strip():
        raise DocumentParseError(
            "未提取到有效文字；扫描文档需要后续接入 OCR"
        )

    return result