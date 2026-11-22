"""使用固定文本检查中文词语和英文技术标识的提取结果。"""

from service.text_tokenizer_service import extract_terms


def main() -> None:
    """展示词项结果，不访问数据库或外部模型服务。"""
    examples = [
        "请问如何通过深度学习评估鱼类的摄食强度？",
        "YOLOv11 与 ResNet-50 用于目标检测。",
        "ＹＯＬＯｖ１１用于文献检索。",
    ]

    for text in examples:
        print(f"原文：{text}")
        print(f"词项：{sorted(extract_terms(text))}")
        print()


if __name__ == "__main__":
    main()