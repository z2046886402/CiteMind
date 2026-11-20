"""组织流式文献问答，并在完整生成、引用校验后保存结果。"""

import os
from collections.abc import Generator
from contextlib import closing
from typing import Any

from exceptions.chat import ChatServiceError
from schemas.chat import DocumentChatRequest, DocumentChatResponse
from schemas.context import ConversationTurn
from schemas.search import SemanticSearchRequest
from service.chat_service import (
    CITATION_PATTERN,
    INSUFFICIENT_ANSWER,
    SYSTEM_PROMPT,
    _build_references,
    _rewrite_question,
)
from service.chat_stream_service import stream_chat_model
from service.retrieval_service import semantic_search
from service.session_chat_service import save_session_answer

# 事件名称与事件数据组成一个元组，由路由层转换为 SSE 文本。
StreamEvent = tuple[str, dict[str, Any]]


def _generate_document_answer(
    user_id: int,
    options: DocumentChatRequest,
    history: list[ConversationTurn],
) -> Generator[StreamEvent, None, DocumentChatResponse]:
    """发送生成过程事件，并通过生成器返回值交付完整回答。

    delta 事件中的文本尚未完成引用校验，属于临时内容。
    本函数不保存消息，异常会传递给上层处理。
    """
    yield "status", {"message": "正在理解问题并检索文献"}

    retrieval_question = options.question

    if history:
        rewritten = _rewrite_question(options.question, history)

        if rewritten.needs_clarification:
            return DocumentChatResponse(
                status="insufficient_evidence",
                question=options.question,
                answer="当前追问的指代不明确，请补充具体论文、方法或研究对象。",
                model=None,
                references=[],
                used_citation_ids=[],
                warnings=["当前会话上下文不足以明确追问对象"],
                retrieval_question=None,
                history_turns=len(history),
            )

        retrieval_question = rewritten.question

    retrieval = semantic_search(
        user_id,
        SemanticSearchRequest(
            question=retrieval_question,
            top_k=options.top_k,
            min_similarity=options.min_similarity,
        ),
    )

    # 复用原接口的资料截断及引用编号规则。
    references = _build_references(retrieval.items)
    warnings = list(retrieval.warnings)

    metadata = {
        "retrieval_question": retrieval_question,
        "history_turns": len(history),
    }

    if not references:
        return DocumentChatResponse(
            status="no_evidence",
            question=options.question,
            answer="未找到可用的文献片段，请检查文献索引或调整问题。",
            model=None,
            references=[],
            used_citation_ids=[],
            warnings=warnings,
            **metadata,
        )

    if sum(len(item.content) for item in references) < sum(
        len(item.content) for item in retrieval.items
    ):
        warnings.append(
            "部分参考片段受上下文长度限制，未完整提供给模型"
        )

    payload = {
        "question": options.question,
        "retrieval_question": retrieval_question,
        "history": [turn.model_dump() for turn in history],
        "references": [
            {
                "citation_id": reference.citation_id,
                "file_name": reference.file_name,
                "chunk_index": reference.chunk_index,
                "content": reference.content,
            }
            for reference in references
        ],
    }

    yield "status", {"message": "正在根据文献生成回答"}

    fragments: list[str] = []

    # 上层关闭生成器时，同时关闭模型生成器及其网络连接。
    with closing(stream_chat_model(SYSTEM_PROMPT, payload)) as stream:
        for text in stream:
            fragments.append(text)
            yield "delta", {"content": text}

    answer = "".join(fragments).strip()

    # 底层流式服务已校验正常结束；这里检查完整回答的引用编号。
    used_ids = sorted({
        int(value)
        for value in CITATION_PATTERN.findall(answer)
    })

    if answer == INSUFFICIENT_ANSWER:
        status = "insufficient_evidence"
        used_ids = []
        selected_references = []
    else:
        available_ids = {
            reference.citation_id
            for reference in references
        }

        if not used_ids:
            raise ChatServiceError("模型回答缺少规定的引用标记，请重试")

        if not set(used_ids).issubset(available_ids):
            raise ChatServiceError(
                "模型回答包含不存在的引用编号，请重试"
            )

        status = "generated"
        selected_references = [
            reference
            for reference in references
            if reference.citation_id in used_ids
        ]

    return DocumentChatResponse(
        status=status,
        question=options.question,
        answer=answer,
        # 当前底层流式服务只返回文本，此处记录配置的模型名称。
        model=os.getenv("CHAT_MODEL", "").strip(),
        references=selected_references,
        used_citation_ids=used_ids,
        warnings=warnings,
        **metadata,
    )


def stream_answer_in_session(
    user_id: int,
    session_id: str,
    options: DocumentChatRequest,
    history: list[ConversationTurn],
) -> Generator[StreamEvent, None, None]:
    """输出回答片段，保存成功后发送唯一的 done 事件。

    Args:
        user_id: 从认证信息取得的用户编号。
        session_id: 已验证归属的目标会话。
        options: 问题及检索参数。
        history: 在短数据库会话中读取的历史快照。

    Yields:
        status、delta 或 done 事件。

    Notes:
        模型调用期间不持有数据库连接。
        done 表示完整结果已提交；引用检查不等于事实核验。
        保存失败时不发送 done，调用方应提示用户核对历史记录。
    """
    # yield from 同时转发内部事件，并接收内部生成器的返回值。
    result = yield from _generate_document_answer(
        user_id,
        options,
        history,
    )

    yield "status", {"message": "正在保存回答"}

    saved_result = save_session_answer(
        user_id,
        session_id,
        result,
    )

    yield "done", saved_result.model_dump(mode="json")