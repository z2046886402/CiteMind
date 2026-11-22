/**
 * 展示整个来源分块的页码和表格标识。
 *
 * 引用文本可能经过截短，因此明确使用“来源分块页码”。
 * 对旧索引、历史引用及没有可靠页码的文档展示缺省说明。
 */
import { Space, Tag } from 'antd'

interface ChunkSourceTagsProps {
  pageNumbers?: number[]
  containsTable?: boolean | null
}

export default function ChunkSourceTags({
  pageNumbers,
  containsTable,
}: ChunkSourceTagsProps) {
  const pages = pageNumbers ?? []

  return (
    <Space
      wrap
      size={[4, 4]}
      style={{ marginBottom: 12 }}
    >
      <Tag>
        来源分块页码：
        {pages.length ? pages.join('、') : '未提供'}
      </Tag>

      <Tag color={containsTable ? 'purple' : undefined}>
        {containsTable == null
          ? '表格信息未提供'
          : containsTable
            ? '分块含表格'
            : '分块不含表格'}
      </Tag>
    </Space>
  )
}