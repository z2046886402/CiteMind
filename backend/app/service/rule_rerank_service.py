"""通过词项覆盖率和已有余弦相似度，对候选片段进行本地重排。"""

import math
import re

from schemas.search import SemanticSearchItem


KEYWORD_WEIGHT = 0.3
VECTOR_WEIGHT = 0.7

# 英文按单词及常见技术标识匹配，中文按单字匹配。
# 这是当前项目的基础适配，不等同于原项目的专业分词器。
TERM_PATTERN = re.compile(
    r"[a-z0-9]+(?:[-_.][a-z0-9]+)*|[\u3400-\u9fff]",
    re.IGNORECASE,
)


def _extract_terms(text: str) -> set[str]:
    """提取不区分大小写的去重词项。

    使用集合避免同一词项重复出现时，人为提高覆盖率。
    标点和空白不参与匹配。
    """
    return set(TERM_PATTERN.findall(text.casefold()))


def rerank_by_rule(
    question: str,
    items: list[SemanticSearchItem],
) -> list[SemanticSearchItem]:
    """结合词项覆盖率与余弦相似度，对候选片段重新排序。

    Args:
        question: 本次检索问题；多轮问答应传入改写后的检索问题。
        items: 调用方已完成用户归属校验的候选片段。

    Returns:
        按重排分数降序排列的新列表；同分保持输入顺序。
        空候选列表返回空列表。

    Raises:
        ValueError: 问题为空，或候选的余弦相似度无效。

    Notes:
        词项覆盖率 = 候选命中的问题词项数 / 问题词项总数。
        重排分数 = 0.3 × 覆盖率 + 0.7 × 原始余弦相似度。
        问题没有可提取词项时，覆盖率记为 0。
        不修改输入列表、片段正文、原文位置和原始召回分数。
        本函数不访问数据库、Elasticsearch 或外部模型。
    """
    if not question.strip():
        raise ValueError("重排问题不能为空")

    query_terms = _extract_terms(question)

    scored_items: list[tuple[float, SemanticSearchItem]] = []

    for item in items:
        cosine = item.cosine_similarity

        if not math.isfinite(cosine) or not -1.0 <= cosine <= 1.0:
            raise ValueError("候选片段的余弦相似度无效")

        document_terms = _extract_terms(item.content)

        coverage = (
            len(query_terms & document_terms) / len(query_terms)
            if query_terms
            else 0.0
        )

        rerank_score = (
            KEYWORD_WEIGHT * coverage
            + VECTOR_WEIGHT * cosine
        )

        # 创建副本，避免覆盖其他调用方持有的原始检索结果。
        ranked_item = item.model_copy(
            update={
                "rerank_method": "rule",
                "rerank_score": rerank_score,
            }
        )

        scored_items.append((rerank_score, ranked_item))

    # Python 排序保持稳定，因此同分片段沿用原来的召回顺序。
    scored_items.sort(key=lambda pair: pair[0], reverse=True)

    return [item for _, item in scored_items]