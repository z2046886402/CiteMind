"""使用固定词项和候选片段验证加权规则重排。"""

from schemas.search import SemanticSearchItem
from service.rule_rerank_service import rerank_by_rule
from service.term_weight_service import build_query_weights
from service.text_tokenizer_service import extract_terms


def main() -> None:
    """展示词项权重，以及相同余弦相似度下的排序差异。"""
    question = "深度学习 摄食强度"

    weights = build_query_weights(extract_terms(question))

    print("查询词项权重：")
    for term, weight in weights.items():
        print(f"{term}：{weight:.3f}")

    samples = [
        (1, "深度学习"),
        (2, "摄食强度"),
    ]

    items = [
        SemanticSearchItem(
            document_id=document_id,
            file_name=f"sample_{document_id}.txt",
            chunk_index=1,
            content=content,
            start_char=0,
            end_char=len(content),
            score=float(document_id),
            # 固定向量相似度，只观察词项权重造成的差异。
            cosine_similarity=0.5,
        )
        for document_id, content in samples
    ]

    print("\n重排结果：")
    for item in rerank_by_rule(question, items):
        print(
            f"文献 {item.document_id}："
            f"{item.content}，"
            f"重排分数 {item.rerank_score:.3f}"
        )


if __name__ == "__main__":
    main()