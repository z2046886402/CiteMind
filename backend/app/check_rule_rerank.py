"""使用固定候选验证规则重排，不访问外部服务。"""

from schemas.search import SemanticSearchItem
from service.rule_rerank_service import rerank_by_rule


def main() -> None:
    """展示重排后的顺序及分数，验证输入结果没有被修改。"""
    samples = [
        (1, "Fish feeding intensity assessment.", 0.80),
        (2, "YOLO detects fish feeding behavior.", 0.75),
        (3, "Weather forecasting with neural networks.", 0.90),
    ]

    items = [
        SemanticSearchItem(
            document_id=document_id,
            file_name=f"sample_{document_id}.txt",
            chunk_index=1,
            content=content,
            start_char=0,
            end_char=len(content),
            score=10.0 - document_id,
            cosine_similarity=cosine,
        )
        for document_id, content, cosine in samples
    ]

    ranked = rerank_by_rule("YOLO fish", items)

    for rank, item in enumerate(ranked, start=1):
        print(
            f"第 {rank} 名：文献 {item.document_id}，"
            f"余弦相似度 {item.cosine_similarity:.3f}，"
            f"重排分数 {item.rerank_score:.3f}"
        )

    print(
        "原始候选未被修改：",
        all(item.rerank_score is None for item in items),
    )


if __name__ == "__main__":
    main()