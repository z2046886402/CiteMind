/**
 * 文献分块预览弹窗。
 *
 * 用户提交参数后请求后端；分页仅控制当前展示的分块，
 * 不会在翻页时重新解析文献。
 */
import {
  Alert,
  Button,
  Form,
  InputNumber,
  Modal,
  Pagination,
  Space,
  Spin,
} from 'antd'
import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import { generateDocumentChunks } from '../../../api/repository'
import type {
  DocumentChunkOptions,
  DocumentChunkResult,
  DocumentItem,
} from '../../../api/repository'

interface ChunkPreviewProps {
  document: DocumentItem
  onClose: () => void
}

export default function ChunkPreview({
  document,
  onClose,
}: ChunkPreviewProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<DocumentChunkResult | null>(null)
  const [currentPage, setCurrentPage] = useState(1)

  // 同时用于取消请求和阻止重复提交，不依赖状态更新的时机。
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => controllerRef.current?.abort()
  }, [])

  /** 请求分块结果；新请求开始时清除上一次结果和页码。 */
  async function handleGenerate(
    options: DocumentChunkOptions,
  ): Promise<void> {
    if (controllerRef.current) {
      return
    }

    const controller = new AbortController()
    controllerRef.current = controller

    setLoading(true)
    setError('')
    setResult(null)
    setCurrentPage(1)

    try {
      const data = await generateDocumentChunks(
        document.id,
        options,
        controller.signal,
      )

      if (!controller.signal.aborted) {
        setResult(data)
      }
    } catch (error) {
      if (controller.signal.aborted || axios.isCancel(error)) {
        return
      }

      let description = '分块失败，请检查后端服务或稍后重试'

      if (axios.isAxiosError<{ detail?: unknown }>(error)) {
        const detail = error.response?.data?.detail

        if (typeof detail === 'string') {
          description = detail
        } else if (error.code === 'ECONNABORTED') {
          description = '分块等待超时，请稍后重试'
        }
      }

      setError(description)
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false)
      }

      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  }

  const currentChunk = result?.chunks[currentPage - 1]

  return (
    <Modal
      title={`分块预览：${document.file_name}`}
      open
      width={1000}
      onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      <Form<DocumentChunkOptions>
        layout="inline"
        initialValues={{
          chunk_size: 512,
          chunk_overlap: 64,
        }}
        disabled={loading}
        onFinish={handleGenerate}
      >
        <Form.Item
          label="分块大小"
          name="chunk_size"
          style={{ marginBottom: 16 }}
          rules={[
            {
              required: true,
              type: 'integer',
              min: 64,
              max: 2048,
              message: '请输入 64—2048 的整数',
            },
          ]}
        >
          <InputNumber min={64} max={2048} precision={0} />
        </Form.Item>

        <Form.Item
          label="重叠数量"
          name="chunk_overlap"
          dependencies={['chunk_size']}
          style={{ marginBottom: 16 }}
          rules={[
            {
              required: true,
              type: 'integer',
              min: 0,
              message: '请输入非负整数',
            },
            ({ getFieldValue }) => ({
              validator(_, value: number | undefined) {
                const size = getFieldValue('chunk_size') as
                  | number
                  | undefined

                if (
                  typeof value === 'number' &&
                  typeof size === 'number' &&
                  value > Math.floor(size / 2)
                ) {
                  return Promise.reject(
                    new Error('重叠数量不能超过分块大小的一半'),
                  )
                }

                return Promise.resolve()
              },
            }),
          ]}
        >
          <InputNumber min={0} max={1024} precision={0} />
        </Form.Item>

        <Form.Item style={{ marginBottom: 16 }}>
          <Button type="primary" htmlType="submit" loading={loading}>
            生成分块
          </Button>
        </Form.Item>
      </Form>

      {loading && (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Spin />
          <p>正在解析文献并生成分块……</p>
        </div>
      )}

      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          style={{ marginBottom: 16 }}
        />
      )}

      {result && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message={
              `共 ${result.total_chunks} 块；` +
              `本次大小 ${result.chunk_size} Token，` +
              `目标重叠 ${result.chunk_overlap} Token`
            }
          />

          {result.warnings.map((warning, index) => (
            <Alert
              key={`${index}-${warning}`}
              type="warning"
              showIcon
              message={warning}
            />
          ))}

          {currentChunk && (
            <>
              <Space wrap>
                <strong>第 {currentChunk.chunk_index} 块</strong>
                <span>字符数：{currentChunk.character_count}</span>
                <span>原文 Token 数：{currentChunk.token_count}</span>
              </Space>

              <div>
                全文字符范围：
                [{currentChunk.start_char}, {currentChunk.end_char})；
                Token 范围：
                [{currentChunk.start_token}, {currentChunk.end_token})
              </div>

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
                {currentChunk.content}
              </pre>

              <Pagination
                current={currentPage}
                pageSize={1}
                total={result.chunks.length}
                showSizeChanger={false}
                showQuickJumper
                onChange={setCurrentPage}
              />
            </>
          )}

          <small>
            范围从 0 开始，结束位置不包含在内；
            为保持字符完整，实际重叠数量可能略小于目标值。
          </small>
        </Space>
      )}
    </Modal>
  )
}