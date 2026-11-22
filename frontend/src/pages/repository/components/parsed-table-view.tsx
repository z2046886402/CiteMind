/**
 * 展示解析器返回的表格行列数据。
 *
 * 不推断第一行为表头，所有原始行均作为数据展示。
 * 列数和单元格长度限制只影响预览，不修改解析结果。
 */
import { Alert, Space, Table } from 'antd'
import type { TableColumnsType } from 'antd'
import { useMemo } from 'react'


interface ParsedTableViewProps {
  rows: (string | null)[][]
}

interface TableRow {
  key: number
  cells: (string | null)[]
}

const MAX_PREVIEW_COLUMNS = 20
const MAX_CELL_CHARACTERS = 200

/** 按 Unicode 码点截取单元格文字，避免截断代理对。 */
function previewCell(text: string): string {
  const characters = Array.from(text)

  return characters.length > MAX_CELL_CHARACTERS
    ? characters.slice(0, MAX_CELL_CHARACTERS).join('') + '…'
    : text
}

export default function ParsedTableView({
  rows,
}: ParsedTableViewProps) {
  const columnCount = rows.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    0,
  )

  const columns = useMemo<TableColumnsType<TableRow>>(
    () =>
      Array.from(
        {
          length: Math.min(
            columnCount,
            MAX_PREVIEW_COLUMNS,
          ),
        },
        (_, index) => ({
          title: `列 ${index + 1}`,
          key: index,
          width: 160,
          render: (_value: unknown, row: TableRow) => (
            <span
              style={{
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {row.cells[index] == null
                ? '—'
                : previewCell(row.cells[index])}
            </span>
          ),
        }),
      ),
    [columnCount],
  )

  // 使用原始行序号作为当前静态预览的行标识。
  const dataSource = useMemo(
    () =>
      rows.map((cells, index) => ({
        key: index,
        cells,
      })),
    [rows],
  )

  return (
    <Space
      direction="vertical"
      style={{ width: '100%' }}
    >
      <span>
        共 {rows.length} 行、{columnCount} 列
      </span>

      <Alert
        type="info"
        showIcon
        message={
          '预览最多展示前 20 列，单元格最多展示 200 个字符；' +
          '完整数据保留在解析结果中。'
        }
      />

      <Table<TableRow>
        size="small"
        bordered
        columns={columns}
        dataSource={dataSource}
        rowKey="key"
        scroll={{ x: 'max-content' }}
        pagination={{
          pageSize: 10,
          showSizeChanger: false,
          hideOnSinglePage: true,
        }}
      />
    </Space>
  )
}