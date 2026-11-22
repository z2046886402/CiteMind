"""处理知识库文献的本机存储和数据库记录。"""

import logging
from pathlib import Path
from typing import BinaryIO

from sqlalchemy.orm import Session

from models.knowledgebase import KnowledgeBase
from schemas.document import DocumentUploadData
from schemas.document import DocumentListItem

from uuid import uuid4

from exceptions.document import DocumentNotFoundError

from schemas.document import DocumentParseResponse
from service.text_parser import parse_file_structured

from schemas.document import DocumentChunkRequest, DocumentChunkResponse
from service.text_chunker import (
    TOKENIZER_NAME,
    collect_table_row_ranges,
    split_text,
)

from service.search_cleanup_service import delete_document_chunks
from service.chunk_source_service import attach_chunk_sources
logger = logging.getLogger(__name__)

# 使用绝对路径，避免启动目录变化导致文件保存位置发生变化。
STORAGE_ROOT = (
    Path(__file__).resolve().parents[2] / "storage" / "file"
)

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}
MAX_FILE_SIZE = 20 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024


def upload_document(
    db: Session,
    user_id: int,
    filename: str,
    content: BinaryIO,
) -> DocumentUploadData:
    """保存一份文献，并提交对应的数据库记录。

    Args:
        db: 当前请求使用的数据库会话。
        user_id: 从已验证 JWT 中取得的用户编号。
        filename: 客户端提交的原始文件名。
        content: 上传文件的二进制读取对象。

    Returns:
        上传成功的文献编号、原始名称及实际文件大小。

    Raises:
        ValueError: 文件名称、扩展名或大小不符合要求。
        OSError: 文件目录创建或写入失败。
        SQLAlchemyError: 数据库写入失败。

    Notes:
        文件系统和数据库不共享事务。普通执行异常时会回滚记录，
        并尝试清理文件；进程突然退出时仍可能留下孤立文件。
    """
    if not filename or len(filename) > 255:
        raise ValueError("文件名不能为空，且不能超过 255 个字符")

    if any(character in filename for character in ("/", "\\", "\x00")):
        raise ValueError("文件名不能包含路径分隔符或空字符")

    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise ValueError("仅支持 PDF、DOCX、TXT 文件")

    record = KnowledgeBase(
        user_id=str(user_id),
        file_name=filename,
    )

    document_dir: Path | None = None
    stored_path: Path | None = None
    directory_created = False

    try:
        db.add(record)

        # 获取数据库分配的编号，但暂不提交；文件保存成功后统一提交。
        db.flush()
        record_id = record.id

        document_dir = STORAGE_ROOT / str(user_id) / str(record_id)
        document_dir.mkdir(parents=True, exist_ok=False)
        directory_created = True

        # 不使用客户端文件名构造保存路径，避免路径注入和同名覆盖。
        stored_path = document_dir / f"source{extension}"
        file_size = 0

        with stored_path.open("xb") as destination:
            while chunk := content.read(CHUNK_SIZE):
                file_size += len(chunk)

                if file_size > MAX_FILE_SIZE:
                    raise ValueError("文件大小不能超过 20 MiB")

                destination.write(chunk)

        if file_size == 0:
            raise ValueError("不能上传空文件")

        result = DocumentUploadData(
            file_id=str(record_id),
            file_name=filename,
            file_size=file_size,
        )

        db.commit()
    except Exception:
        try:
            db.rollback()
        finally:
            # 只清理本次成功创建的目录，不递归删除用户目录。
            if directory_created:
                try:
                    if stored_path is not None:
                        stored_path.unlink(missing_ok=True)
                    if document_dir is not None:
                        document_dir.rmdir()
                except OSError:
                    logger.exception(
                        "上传失败后的文件清理异常，user_id=%s",
                        user_id,
                    )
        raise

    logger.info(
        "文献上传成功，user_id=%s，document_id=%s，file_size=%s",
        user_id,
        result.file_id,
        result.file_size,
    )
    return result


def list_documents(
    db: Session,
    user_id: int,
) -> list[DocumentListItem]:
    """查询当前用户的文献，按创建时间升序返回。

    Args:
        db: 当前请求使用的数据库会话。
        user_id: 从已验证 JWT 中取得的用户编号。

    Returns:
        当前用户的文献列表；没有记录时返回空列表。

    Raises:
        SQLAlchemyError: 数据库查询失败。

    Notes:
        当前阶段返回全部记录，前端负责分页展示。
        数据量增长后应改为数据库分页。
    """
    records = (
        db.query(KnowledgeBase)
        .filter(KnowledgeBase.user_id == str(user_id))
        # 按上传时间升序排列；时间相同时按记录编号排序，保证顺序稳定。
        .order_by(
            KnowledgeBase.created_at.asc(),
            KnowledgeBase.id.asc(),
        )
        .all()
    )

    return [
        DocumentListItem(
            id=record.id,
            file_name=record.file_name,
            created_at=record.created_at,
            updated_at=record.updated_at,
            index_status=record.index_status,
            index_started_at=record.index_started_at,
            index_finished_at=record.index_finished_at,
            index_error=record.index_error,
            indexed_at=record.indexed_at,
            indexed_chunks=record.indexed_chunks,
        )
        for record in records
    ]


def delete_document(
    db: Session,
    user_id: int,
    document_id: int,
) -> bool:
    """删除当前用户的一份文献。

    Args:
        db: 当前请求使用的数据库会话。
        user_id: 从已验证 JWT 中取得的用户编号。
        document_id: 数据库中的真实文献编号。

    Returns:
        原文件清理是否完成；False 表示记录已删除，但文件清理失败。

        Raises:
        DocumentNotFoundError: 文献不存在或不属于当前用户。
        SearchIndexError: 搜索分块清理未完成。
        ApiError: Elasticsearch API 请求失败。
        TransportError: 搜索服务连接失败。
        OSError: 文件暂存或清理失败。
        SQLAlchemyError: 数据库操作失败。

    Notes:
        先暂存原文件，再清理搜索分块，最后提交数据库删除。
        搜索清理失败时保留数据库记录，并尝试恢复原文件名。
        搜索清理成功后若数据库提交失败，索引不会自动恢复，
        需要重新建立索引；本流程不是跨系统原子事务。
    """
    source_path: Path | None = None
    staged_path: Path | None = None
    file_staged = False

    try:
        # 锁定目标记录，串行处理针对同一文献的并发删除。
        record = (
            db.query(KnowledgeBase)
            .filter(
                KnowledgeBase.id == document_id,
                KnowledgeBase.user_id == str(user_id),
            )
            .with_for_update()
            .first()
        )

        if record is None:
            raise DocumentNotFoundError("文献不存在")

        extension = Path(record.file_name).suffix.lower()
        if extension not in ALLOWED_EXTENSIONS:
            raise ValueError("文献存储信息异常")

        document_dir = STORAGE_ROOT / str(user_id) / str(document_id)
        source_path = document_dir / f"source{extension}"

        # 删除前确认实际路径位于文献存储根目录内。
        if not source_path.resolve().is_relative_to(STORAGE_ROOT.resolve()):
            raise ValueError("文献存储路径异常")

        staged_path = document_dir / f".deleting-{uuid4().hex}"

        # 临时改名保留恢复机会，避免数据库失败时原文件已经被永久删除。
        source_path.rename(staged_path)
        file_staged = True

        # 当前仍持有文献行锁，索引写入流程无法同时写入该文献。
        # 搜索分块清理失败时，外层异常处理会回滚并尝试恢复原文件名。
        delete_document_chunks(user_id, document_id)

        db.delete(record)
        db.commit()
    except Exception:
        try:
            db.rollback()
        finally:
            if file_staged and source_path is not None and staged_path is not None:
                try:
                    staged_path.rename(source_path)
                except OSError:
                    logger.exception(
                        "删除失败后的文件恢复异常，document_id=%s",
                        document_id,
                    )
        raise

    # 提交成功后再永久删除文件；此阶段失败不能回滚已提交的记录。
    try:
        staged_path.unlink()
    except OSError:
        logger.exception(
            "文献记录已删除，但原文件清理失败，document_id=%s",
            document_id,
        )
        return False

    try:
        # 仅移除当前文献的空目录，不递归删除用户目录。
        source_path.parent.rmdir()
    except OSError:
        logger.warning(
            "原文件已删除，但文献目录未移除，document_id=%s",
            document_id,
        )

    logger.info(
        "文献删除完成，user_id=%s，document_id=%s",
        user_id,
        document_id,
    )
    return True


def parse_document(
    db: Session,
    user_id: int,
    document_id: int,
) -> DocumentParseResponse:
    """读取当前用户文献并返回文本提取结果。

    Args:
        db: 当前请求使用的数据库会话。
        user_id: 从已验证 JWT 中取得的用户编号。
        document_id: 数据库中的真实文献编号。

    Returns:
        文件名称、文本、字符数、PDF 页数及解析提示。

    Raises:
        DocumentNotFoundError: 文献不存在或不属于当前用户。
        DocumentParseError: 文件内容无法解析。
        OSError: 文件存储异常。
        SQLAlchemyError: 数据库查询失败。

    Notes:
        解析期间持有共享行锁，阻止现有删除流程同时移动原文件。
        锁随当前请求的数据库事务结束而释放。
    """
    record = (
        db.query(KnowledgeBase)
        .filter(
            KnowledgeBase.id == document_id,
            KnowledgeBase.user_id == str(user_id),
        )
        .with_for_update(read=True)
        .first()
    )

    if record is None:
        raise DocumentNotFoundError("文献不存在")

    extension = Path(record.file_name).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise ValueError("文献存储信息异常")

    source_path = (
        STORAGE_ROOT
        / str(user_id)
        / str(document_id)
        / f"source{extension}"
    )

    if not source_path.resolve().is_relative_to(STORAGE_ROOT.resolve()):
        raise ValueError("文献存储路径异常")

    parsed = parse_file_structured(source_path)

    logger.info(
        "文献文本提取完成，user_id=%s，document_id=%s，"
        "characters=%s，blocks=%s，parser=%s",
        user_id,
        document_id,
        len(parsed.content),
        len(parsed.blocks),
        parsed.parser_name,
    )

    return DocumentParseResponse(
        document_id=document_id,
        file_name=record.file_name,
        content=parsed.content,
        character_count=len(parsed.content),
        page_count=parsed.page_count,
        warnings=parsed.warnings,
        parser_name=parsed.parser_name,
        pages=parsed.pages,
        blocks=parsed.blocks,
    )


def chunk_document(
    db: Session,
    user_id: int,
    document_id: int,
    options: DocumentChunkRequest,
) -> DocumentChunkResponse:
    """校验文献归属、提取文本，并生成当前请求的分块结果。

    分块暂不持久化；复用解析业务的归属校验、文件定位和共享锁。
    """
    parsed = parse_document(db, user_id, document_id)

    # 解析器已经提供表格在全文中的位置，直接传给分块器，
    # 不通过搜索表格字符串推算位置，避免相同文字造成误匹配。
    table_ranges = [
        (block.start_char, block.end_char)
        for block in parsed.blocks
        if block.kind == "table"
    ]

    # 从结构化行列数据恢复行边界，避免误拆单元格内部的换行。
    table_row_ranges = collect_table_row_ranges(
        parsed.blocks
    )

    chunks = split_text(
        text=parsed.content,
        chunk_size=options.chunk_size,
        chunk_overlap=options.chunk_overlap,
        table_ranges=table_ranges,
        table_row_ranges=table_row_ranges,
    )

    # 分块完成后，使用同一份解析结果计算来源，避免重新解析。
    chunks = attach_chunk_sources(
        chunks=chunks,
        blocks=parsed.blocks,
    )

    logger.info(
        "文献分块完成，user_id=%s，document_id=%s，chunks=%s",
        user_id,
        document_id,
        len(chunks),
    )

    return DocumentChunkResponse(
        document_id=document_id,
        file_name=parsed.file_name,
        tokenizer=TOKENIZER_NAME,
        chunk_size=options.chunk_size,
        chunk_overlap=options.chunk_overlap,
        total_chunks=len(chunks),
        chunks=chunks,
        warnings=parsed.warnings,
    )
