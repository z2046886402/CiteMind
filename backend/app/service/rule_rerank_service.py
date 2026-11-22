"""通过词项覆盖率和已有余弦相似度，对候选片段进行本地重排。"""

import math
from service.text_tokenizer_service import extract_terms

from schemas.search import SemanticSearchItem

from service.term_weight_service import build_query_weights

KEYWORD_WEIGHT = 0.3
VECTOR_WEIGHT = 0.7


def _extract_terms(text: str) -> set[str]:
    """复用统一词语分词服务，保持问题与候选片段的处理一致。"""
    return extract_terms(text)


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
        加权覆盖率 = 候选命中的查询词项权重之和。
        查询词项权重已经归一化，未配置词项原始权重为 1。
        重排分数 = 0.3 × 加权覆盖率 + 0.7 × 原始余弦相似度。
        问题没有可提取词项时，覆盖率记为 0。
        不修改输入列表、片段正文、原文位置和原始召回分数。
        本函数不访问数据库、Elasticsearch 或外部模型。
    """
    if not question.strip():
        raise ValueError("重排问题不能为空")

    query_terms = _extract_terms(question)

    # 同一问题的权重只计算一次，所有候选使用相同的评分基准。
    query_weights = build_query_weights(query_terms)

    scored_items: list[tuple[float, SemanticSearchItem]] = []

    for item in items:
        cosine = item.cosine_similarity

        if not math.isfinite(cosine) or not -1.0 <= cosine <= 1.0:
            raise ValueError("候选片段的余弦相似度无效")

        document_terms = _extract_terms(item.content)

        # 权重已经归一化，直接累加候选命中的查询词项权重。
        # 空查询词项自然得到 0；上界处理避免浮点误差略微超过 1。
        coverage = min(
            1.0,
            math.fsum(
                weight
                for term, weight in query_weights.items()
                if term in document_terms
            ),
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
