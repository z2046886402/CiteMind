/**
 * 展示解析结果的页级文本和全文。
 *
 * 分页只切换已经返回的数据，不重新请求解析接口。
 * 文本直接使用后端 block.text，避免前后端字符计数差异造成错位。
 */
import {
  Alert,
  Empty,
  Pagination,
  Space,
  Tabs,
  Tag,
} from 'antd'
import { useMemo, useState } from 'react'
import type {
  DocumentParseResult,
  ParsedBlock,
} from '../../../api/repository'

const PREVIEW_CHARACTER_LIMIT = 20000

const BLOCK_LABEL: Record<ParsedBlock['kind'], string> = {
  heading: '标题',
  paragraph: '正文块',
  table: '表格',
}

/** 按 Unicode 码点截取，避免在 emoji 的代理对中间截断。 */
function limitPreview(
  text: string,
): { text: string; truncated: boolean } {
  const characters: string[] = []

  for (const character of text) {
    if (characters.length === PREVIEW_CHARACTER_LIMIT) {
      return {
        text: characters.join(''),
        truncated: true,
      }
    }

    characters.push(character)
  }

  return {
    text: characters.join(''),
    truncated: false,
  }
}

/** 有长度限制的普通文本视图，不将文献内容作为 HTML 执行。 */
function TextPreview({ text }: { text: string }) {
  const preview = useMemo(() => limitPreview(text), [text])

  return (
    <>
      {preview.truncated && (
        <Alert
          type="info"
          showIcon
          message="当前视图仅展示前 20,000 个字符，解析结果保持完整。"
          style={{ marginBottom: 12 }}
        />
      )}

      <pre
        style={{
          margin: 0,
          padding: 16,
          maxHeight: '45vh',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          background: '#fafafa',
          border: '1px solid #f0f0f0',
          borderRadius: 6,
          fontFamily: 'inherit',
          lineHeight: 1.8,
        }}
      >
        {preview.text}
      </pre>
    </>
  )
}

interface ParsedDocumentViewProps {
  result: DocumentParseResult
}

export default function ParsedDocumentView({
  result,
}: ParsedDocumentViewProps) {
  const [currentPage, setCurrentPage] = useState(1)
  const [currentBlock, setCurrentBlock] = useState(1)

  const pages = result.pages ?? []
  const page = pages[currentPage - 1]
  const pageNumber = page?.page_number

  // 根据真实页码关联文本块，不通过字符数量推算页面。
  const pageBlocks = useMemo(
    () =>
      (result.blocks ?? []).filter((block) =>
        block.positions.some(
          (position) => position.page_number === pageNumber,
        ),
      ),
    [result.blocks, pageNumber],
  )

  const block = pageBlocks[currentBlock - 1]

  // DOCX、TXT 当前没有可靠页码，继续提供全文预览。
  if (!pages.length) {
    return <TextPreview text={result.content} />
  }

  const pageView = (
    <Space
      direction="vertical"
      size="middle"
      style={{ width: '100%' }}
    >
      <span>选择页码：</span>

      <Pagination
        current={currentPage}
        pageSize={1}
        total={pages.length}
        showSizeChanger={false}
        showQuickJumper
        onChange={(nextPage) => {
          setCurrentPage(nextPage)

          // 切换页面后，从该页第一个关联文本块开始展示。
          setCurrentBlock(1)
        }}
      />

      {page && (
        <Space wrap>
          <Tag color="blue">第 {page.page_number} 页</Tag>
          <span>
            页面尺寸：{page.width.toFixed(1)} ×{' '}
            {page.height.toFixed(1)} pt
          </span>
          <span>本页关联 {pageBlocks.length} 个文本块</span>
        </Space>
      )}

      {!pageBlocks.length ? (
        <Empty description="本页未提取到文字，可能为空白页或需要 OCR" />
      ) : block && (
        <>
          <Space wrap>
            <Tag>{BLOCK_LABEL[block.kind]}</Tag>

            <span>解析块编号：{block.block_index}</span>

            <span>
              解析后全文字符范围：
              [{block.start_char}, {block.end_char})
            </span>

            <span>
              来源页：
              {Array.from(
                new Set(
                  block.positions.map(
                    (position) => position.page_number,
                  ),
                ),
              )
                .sort((a, b) => a - b)
                .join('、')}
            </span>
          </Space>

          <TextPreview text={block.text} />

          <Pagination
            current={currentBlock}
            pageSize={1}
            total={pageBlocks.length}
            showSizeChanger={false}
            hideOnSinglePage
            onChange={(nextBlock) => setCurrentBlock(nextBlock)}
          />
        </>
      )}
    </Space>
  )

  return (
    <Tabs
      defaultActiveKey="pages"
      items={[
        {
          key: 'pages',
          label: '按页文本',
          children: pageView,
        },
        {
          key: 'full',
          label: '全文文本',
          children: <TextPreview text={result.content} />,
        },
      ]}
    />
  )
}