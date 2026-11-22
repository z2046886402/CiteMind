/**
 * 展示引用文本和对应 PDF 原文。
 *
 * PDF 标签默认延迟挂载，用户打开该标签时才获取原文件。
 * 来源标签放在正文之外，保持引用文本的纯文本展示。
 */
import { Tabs } from 'antd'
import type { AnswerReference } from '../../../api/chat'
import ChunkSourceTags from '../../../components/chunk-source-tags'
import PdfOriginalPreview from '../../../components/pdf-original-preview'

interface ReferencePreviewProps {
  reference: AnswerReference
}

export default function ReferencePreview({
  reference,
}: ReferencePreviewProps) {
  const textView = (
    <>
      <p>
        文献 ID：{reference.document_id}；
        分块编号：{reference.chunk_index}
      </p>

      <ChunkSourceTags
        pageNumbers={reference.page_numbers}
        containsTable={reference.contains_table}
      />

      <pre
        style={{
          padding: 16,
          maxHeight: '55vh',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          background: '#fafafa',
          borderRadius: 6,
          fontFamily: 'inherit',
          lineHeight: 1.8,
        }}
      >
        {reference.content}
      </pre>

      <p>
        解析后全文字符范围：
        [{reference.start_char}, {reference.end_char})
      </p>
    </>
  )

  const items = [
    {
      key: 'text',
      label: '引用文本',
      children: textView,
    },
  ]

  if (reference.file_name.toLowerCase().endsWith('.pdf')) {
    items.push({
      key: 'pdf',
      label: 'PDF 原文',
      children: (
        <PdfOriginalPreview
          documentId={reference.document_id}
          fileName={reference.file_name}
          pageNumbers={reference.page_numbers}
        />
      ),
    })
  }

  return (
    <Tabs
      defaultActiveKey="text"
      items={items}
    />
  )
}