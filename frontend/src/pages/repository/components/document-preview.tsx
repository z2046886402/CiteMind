/**
 * 文献文本预览弹窗。
 *
 * 挂载时请求解析，卸载时取消客户端请求。
 * 文本按普通字符串渲染，不将文献内容作为 HTML 执行。
 */
import { Alert, Button, Modal, Space, Spin } from 'antd'
import axios from 'axios'
import { useEffect, useState } from 'react'
import { parseDocument } from '../../../api/repository'
import type {
  DocumentItem,
  DocumentParseResult,
} from '../../../api/repository'

import ParsedDocumentView from './parsed-document-view'

interface DocumentPreviewProps {
  document: DocumentItem
  onClose: () => void
}

export default function DocumentPreview({
  document,
  onClose,
}: DocumentPreviewProps) {
  const [result, setResult] = useState<DocumentParseResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const documentId = document.id

  useEffect(() => {
    const controller = new AbortController()

    /** 加载当前文献文本，并忽略取消后的响应。 */
    async function loadPreview(): Promise<void> {
      setLoading(true)
      setError('')
      setResult(null)

      try {
        const data = await parseDocument(documentId, controller.signal)

        if (!controller.signal.aborted) {
          setResult(data)
        }
      } catch (error) {
        if (controller.signal.aborted || axios.isCancel(error)) {
          return
        }

        let description = '解析失败，请检查后端服务或稍后重试'

        if (axios.isAxiosError<{ detail?: unknown }>(error)) {
          const detail = error.response?.data?.detail

          if (typeof detail === 'string') {
            description = detail
          } else if (error.code === 'ECONNABORTED') {
            description = '解析等待超时，请稍后重试'
          }
        }

        setError(description)
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void loadPreview()

    // 取消客户端等待；不代表服务器中的同步解析会立即停止。
    return () => controller.abort()
  }, [documentId])

  return (
    <Modal
      title={`解析预览：${document.file_name}`}
      open
      width={900}
      onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      {loading && (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <Spin />
          <p>正在提取文献文本，请稍候……</p>
        </div>
      )}

      {error && <Alert type="error" showIcon message={error} />}

      {result && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space wrap>
            <span>
              提取字符数：{result.character_count.toLocaleString()}
            </span>

            {result.page_count !== null && (
              <span>PDF 页数：{result.page_count}</span>
            )}
          </Space>

          {result.warnings.map((warning, index) => (
            <Alert
              key={`${index}-${warning}`}
              type="warning"
              showIcon
              message={warning}
            />
          ))}


          <ParsedDocumentView
            key={result.document_id}
            result={result}
          />

        </Space>
      )}
    </Modal>
  )
}