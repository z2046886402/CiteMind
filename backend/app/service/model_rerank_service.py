"""调用千问AI平台的 OpenAI 兼容重排接口，保持评分与原片段正确对应。"""

import logging
import math
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from dotenv import load_dotenv

from exceptions.search import SearchIndexError
from schemas.search import SemanticSearchItem


logger = logging.getLogger(__name__)

MAX_MODEL_CANDIDATES = 20
MAX_SCORING_CHARACTERS = 2000


def _parse_scores(payload: Any, count: int) -> list[float]:
    """检查重排响应，并按原始输入顺序返回完整分数。

    服务端通常按相关性降序返回结果，因此必须使用 index
    还原对应关系，不能直接将返回顺序与输入片段逐项配对。
    """
    # OpenAI 兼容重排接口直接在顶层返回 results。
    results = payload.get("results") if isinstance(payload, dict) else None

    if not isinstance(results, list) or len(results) != count:
        raise SearchIndexError("模型重排未返回完整的候选结果")

    scores: dict[int, float] = {}

    for result in results:
        if not isinstance(result, dict):
            raise SearchIndexError("模型重排响应格式不正确")

        index = result.get("index")
        score = result.get("relevance_score")

        if (
            type(index) is not int
            or not 0 <= index < count
            or index in scores
        ):
            raise SearchIndexError("模型重排结果索引重复或越界")

        if (
            type(score) not in (int, float)
            or not 0 <= score <= 1
            or not math.isfinite(score)
        ):
            raise SearchIndexError("模型重排返回了无效分数")

        scores[index] = float(score)

    return [scores[index] for index in range(count)]


def rerank_by_model(
    question: str,
    items: list[SemanticSearchItem],
) -> tuple[list[SemanticSearchItem], list[str]]:
    """通过外部模型重排候选，返回新列表及处理提示。

    Args:
        question: 本次检索问题，多轮问答应使用改写后的问题。
        items: 已验证用户归属的候选片段，最多 20 条。

    Returns:
        按模型分数降序排列的候选，以及评分文本截断提示。

    Raises:
        ValueError: 问题或候选输入不符合要求。
        SearchIndexError: 配置、网络请求或响应校验失败。

    Notes:
        仅使用每段前 2000 个字符评分，保留完整正文及原文位置。
        字符预算不等同于供应商的 Token 限制。
        不自动重试，不自动降级为规则重排。
        不记录密钥、问题、正文或服务端原始错误内容。
    """
    if not question.strip() or len(question) > 1000:
        raise ValueError("模型重排问题必须为 1 至 1000 个字符")

    if len(items) > MAX_MODEL_CANDIDATES:
        raise ValueError("模型重排候选不能超过 20 条")

    if not items:
        return [], []

    if any(not item.content.strip() for item in items):
        raise ValueError("模型重排候选正文不能为空")

    env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(env_path)

    api_url = os.getenv("RERANK_API_URL", "").strip()
    api_key = os.getenv("RERANK_API_KEY", "").strip()
    model = os.getenv("RERANK_MODEL", "qwen3-rerank").strip()

    if not api_url or not api_key or not model:
        raise SearchIndexError(
            "请配置 RERANK_API_URL、RERANK_API_KEY 和 RERANK_MODEL"
        )

    try:
        address = urlsplit(api_url)
        valid_address = (
            address.scheme == "https"
            and bool(address.hostname)
            and address.username is None
            and address.password is None
            and not address.fragment
        )
    except ValueError:
        valid_address = False

    if not valid_address:
        raise SearchIndexError("重排接口必须是有效的 HTTPS 地址")

    if address.path.rstrip("/").endswith("/compatible-mode/v1"):
        raise SearchIndexError(
            "当前配置是聊天接口基础地址，"
            "重排接口应使用 /compatible-api/v1/reranks"
        )

    documents = [
        item.content[:MAX_SCORING_CHARACTERS]
        for item in items
    ]

    warnings: list[str] = []

    if any(len(item.content) > MAX_SCORING_CHARACTERS for item in items):
        warnings.append(
            "模型重排仅使用较长片段的前 2000 个字符评分，"
            "引用仍保留完整候选片段"
        )

    try:
        with httpx.Client(
            timeout=httpx.Timeout(60.0, connect=10.0),
            follow_redirects=False,
        ) as client:
            response = client.post(
                api_url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                },
                # 兼容协议使用扁平请求体，不嵌套 input 和 parameters。
                json={
                    "model": model,
                    "query": question,
                    "documents": documents,
                    # 返回全部候选的分数，随后按 index 对齐原片段。
                    "top_n": len(documents),
                },
            )
            response.raise_for_status()
            payload = response.json()

    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        logger.error(
            "模型重排请求被拒绝，status_code=%s",
            status_code,
        )
        raise SearchIndexError(
            f"模型重排请求失败（HTTP {status_code}），"
            "请检查接口地址、密钥和模型权限"
        ) from exc

    except httpx.RequestError as exc:
        logger.error(
            "模型重排网络请求失败，error_type=%s",
            type(exc).__name__,
        )
        raise SearchIndexError(
            "模型重排连接失败或超时，请检查网络"
        ) from exc

    except ValueError as exc:
        raise SearchIndexError(
            "模型重排接口未返回有效 JSON"
        ) from exc

    scores = _parse_scores(payload, len(items))

    # 按原始索引对应分数，创建副本，不修改原文和召回分数。
    ranked_pairs = [
        (
            score,
            item.model_copy(
                update={
                    "rerank_method": "model",
                    "rerank_score": score,
                }
            ),
        )
        for item, score in zip(items, scores, strict=True)
    ]

    ranked_pairs.sort(key=lambda pair: pair[0], reverse=True)

    return [item for _, item in ranked_pairs], warnings
