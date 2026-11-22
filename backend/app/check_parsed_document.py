"""构造示例数据验证统一解析结构，不读取真实 PDF。"""

from schemas.parsed_document import (
    BlockPosition,
    ParsedBlock,
    ParsedDocument,
    ParsedPage,
)


def main() -> None:
    """验证段落、表格和全文字符位置能够保持一致。"""
    paragraph = "本研究使用目标检测分析鱼类摄食行为。"
    table_text = "指标\t数值\n准确率\t0.90"

    content = paragraph + "\n\n" + table_text
    table_start = len(paragraph) + 2

    result = ParsedDocument(
        format="pdf",
        parser_name="schema_demo",
        content=content,
        page_count=1,
        # 示例页面尺寸，仅用于结构验证。
        pages=[
            ParsedPage(
                page_number=1,
                width=595,
                height=842,
            )
        ],
        blocks=[
            ParsedBlock(
                block_index=1,
                kind="paragraph",
                text=paragraph,
                start_char=0,
                end_char=len(paragraph),
                positions=[BlockPosition(page_number=1)],
            ),
            ParsedBlock(
                block_index=2,
                kind="table",
                text=table_text,
                start_char=table_start,
                end_char=len(content),
                positions=[BlockPosition(page_number=1)],
                table_rows=[
                    ["指标", "数值"],
                    ["准确率", "0.90"],
                ],
            ),
        ],
    )

    print(result.model_dump_json(indent=2))
    print("\n统一解析结构验证成功。")


if __name__ == "__main__":
    main()