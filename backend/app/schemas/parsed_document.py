"""定义文档解析器的统一输出，供分块、引用和页面定位使用。

页码从 1 开始；字符范围采用左闭右开区间。
页面坐标以左上角为原点，向右、向下为正方向，单位为 PDF point。
解析器适配层负责转换原始页码、图像缩放和坐标单位。
"""

from typing import Literal, Self

from pydantic import BaseModel, Field, model_validator


class ParsedPage(BaseModel):
    """保存页面尺寸，后续用于坐标校验与展示比例换算。"""

    page_number: int = Field(ge=1, strict=True)
    width: float = Field(gt=0, allow_inf_nan=False)
    height: float = Field(gt=0, allow_inf_nan=False)


class BlockBoundingBox(BaseModel):
    """描述一个页面内的矩形区域，坐标使用 PDF point。"""

    x0: float = Field(ge=0, allow_inf_nan=False)
    top: float = Field(ge=0, allow_inf_nan=False)
    x1: float = Field(ge=0, allow_inf_nan=False)
    bottom: float = Field(ge=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_rectangle(self) -> Self:
        """拒绝反向或没有面积的区域；未知位置应使用 None。"""
        if self.x1 <= self.x0 or self.bottom <= self.top:
            raise ValueError("页面区域必须具有正的宽度和高度")

        return self


class BlockPosition(BaseModel):
    """记录解析块在某一页的位置。

    已知页码但没有可靠坐标时，bbox 保留为 None。
    跨页或不连续区域通过多个 BlockPosition 表示。
    """

    page_number: int = Field(ge=1, strict=True)
    bbox: BlockBoundingBox | None = None


class ParsedBlock(BaseModel):
    """表示一个标题、段落或表格及其原文位置。

    text 是该块在统一全文中的文本表示。
    表格可以额外携带行列数据或解析器提供的 HTML 标记。
    """

    block_index: int = Field(ge=1, strict=True)
    kind: Literal["heading", "paragraph", "table"]

    text: str = Field(min_length=1)
    start_char: int = Field(ge=0, strict=True)
    end_char: int = Field(ge=0, strict=True)

    positions: list[BlockPosition] = Field(default_factory=list)

    # None 表示尚未恢复该结构；单元格 None 表示空缺或未识别内容。
    table_rows: list[list[str | None]] | None = None
    table_html: str | None = None

    @model_validator(mode="after")
    def validate_block(self) -> Self:
        """检查字符范围，并限制表格字段只能属于表格块。"""
        if not self.text.strip():
            raise ValueError("空白内容不应创建解析块")

        if self.end_char - self.start_char != len(self.text):
            raise ValueError("解析块字符范围与文本长度不一致")

        if self.kind != "table" and (
            self.table_rows is not None
            or self.table_html is not None
        ):
            raise ValueError("标题和段落不能携带表格结构")

        return self


class ParsedDocument(BaseModel):
    """描述一次完整解析的统一结果。

    content 由适配器组织，块的字符位置必须对应这份全文。
    允许没有可提取文字的页面存在，供后续 OCR 流程处理。
    """

    format: Literal["pdf", "docx", "txt"]
    parser_name: str = Field(min_length=1)
    content: str

    page_count: int | None = Field(
        default=None,
        ge=1,
        strict=True,
    )

    pages: list[ParsedPage] = Field(default_factory=list)
    blocks: list[ParsedBlock] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_document(self) -> Self:
        """核对页面、全文范围、块顺序及页面区域的一致性。"""
        if self.page_count is None:
            if self.pages:
                raise ValueError("提供页面信息时必须明确页数")
        elif (
            len(self.pages) != self.page_count
            or any(
                page.page_number != number
                for number, page in enumerate(self.pages, start=1)
            )
        ):
            raise ValueError("页面信息必须按页码完整、连续排列")

        page_map = {
            page.page_number: page
            for page in self.pages
        }

        cursor = 0

        for number, block in enumerate(self.blocks, start=1):
            if block.block_index != number:
                raise ValueError("解析块编号必须从 1 开始连续排列")

            if (
                block.start_char < cursor
                or block.end_char > len(self.content)
            ):
                raise ValueError("解析块范围重叠或超出全文")

            # 块之间允许存在换行等分隔空白，正文必须有对应解析块。
            if self.content[cursor:block.start_char].strip():
                raise ValueError("全文中存在未对应解析块的正文")

            if (
                self.content[block.start_char:block.end_char]
                != block.text
            ):
                raise ValueError("解析块文本与全文字符范围不一致")

            for position in block.positions:
                page = page_map.get(position.page_number)

                if page is None:
                    raise ValueError("解析块引用了不存在的页面")

                if position.bbox is not None and (
                    position.bbox.x1 > page.width
                    or position.bbox.bottom > page.height
                ):
                    raise ValueError("解析块区域超出页面范围")

            cursor = block.end_char

        if self.content[cursor:].strip():
            raise ValueError("全文结尾存在未对应解析块的正文")

        return self