"""加载领域词项权重，并计算当前问题的归一化词项权重。"""

import json
import math
import unicodedata
from functools import lru_cache
from pathlib import Path

from exceptions.search import SearchIndexError


TERM_WEIGHTS_PATH = (
    Path(__file__).resolve().parents[2]
    / "resources"
    / "tokenizer"
    / "term_weights.json"
)


@lru_cache(maxsize=1)
def _load_term_weights() -> dict[str, float]:
    """加载并校验权重配置，每个进程缓存一次。

    词项采用与分词服务一致的 NFKC 和大小写规范化。
    修改配置后，需要重启后端使缓存重新加载。
    """
    try:
        with TERM_WEIGHTS_PATH.open(
            "r",
            encoding="utf-8-sig",
        ) as stream:
            raw = json.load(stream)
    except (OSError, UnicodeError, ValueError) as exc:
        raise SearchIndexError(
            "词项权重配置读取失败，请检查 term_weights.json"
        ) from exc

    if not isinstance(raw, dict):
        raise SearchIndexError("词项权重配置必须是 JSON 对象")

    weights: dict[str, float] = {}

    for term, weight in raw.items():
        key = unicodedata.normalize(
            "NFKC",
            term,
        ).casefold().strip()

        if (
            not key
            or any(char.isspace() for char in key)
            or key in weights
        ):
            raise SearchIndexError(
                "权重配置存在空词项、内部空白或规范化后的词项冲突"
            )

        if (
            type(weight) not in (int, float)
            or not 0 < weight <= 10
            or not math.isfinite(weight)
        ):
            raise SearchIndexError(
                "词项权重必须是大于 0 且不超过 10 的有限数值"
            )

        weights[key] = float(weight)

    return weights


def build_query_weights(terms: set[str]) -> dict[str, float]:
    """计算当前问题中各词项的归一化权重。

    Args:
        terms: 分词服务返回的规范化、去重词项。

    Returns:
        词项到归一化权重的映射，总和约为 1。
        输入为空时返回空字典。

    Notes:
        未配置词项默认使用权重 1.0。
        只在当前问题内部归一化，不与其他问题比较。
        查询权重只计算一次，供所有候选片段共同使用。
    """
    if not terms:
        return {}

    configured = _load_term_weights()

    raw_weights = {
        term: configured.get(term, 1.0)
        for term in sorted(terms)
    }

    total = math.fsum(raw_weights.values())

    return {
        term: weight / total
        for term, weight in raw_weights.items()
    }