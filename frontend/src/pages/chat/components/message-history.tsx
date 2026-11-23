/**
 * 分页展示已保存的会话消息。
 *
 * 默认打开最新一页，页内按消息序号升序显示。
 * 切换会话或离开页面时取消旧查询。
 */
import { Alert, Button, Card, Empty, Pagination, Space, Spin } from 'antd'
import axios from 'axios'
import { useEffect, useState } from 'react'
import { getMessages } from '../../../api/session'
import type { AnswerReference } from '../../../api/chat'
import type { MessageListResult } from '../../../api/session'
import CitedAnswer from './cited-answer'
import ExportAnswerButton from './export-answer-button'


const PAGE_SIZE = 10

interface MessageHistoryProps {
  sessionId: string
  onReadReference: (reference: AnswerReference) => void
  onLoaded: (messageIds: string[]) => void
}

export default function MessageHistory({
  sessionId,
  onReadReference,
  onLoaded,
}: MessageHistoryProps) {
  // 0 表示首次加载时定位到最新一页。
  const [requestedPage, setRequestedPage] = useState(0)
  const [result, setResult] = useState<MessageListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    /** 先取得总数，再定位目标页；第一页结果可以直接复用。 */
    async function loadHistory(): Promise<void> {
      setLoading(true)
      setError('')
      setResult(null)

      try {
        const firstPage = await getMessages(
          sessionId,
          1,
          PAGE_SIZE,
          controller.signal,
        )

        const lastPage = Math.max(1, Math.ceil(firstPage.total / PAGE_SIZE))
        const targetPage =
          requestedPage === 0
            ? lastPage
            : Math.min(requestedPage, lastPage)

        const data =
          targetPage === 1
            ? firstPage
            : await getMessages(
              sessionId,
              targetPage,
              PAGE_SIZE,
              controller.signal,
            )

        if (!controller.signal.aborted) {
          setResult(data)
          onLoaded(data.messages.map((item) => item.message_id))
        }
      } catch (error) {
        if (!controller.signal.aborted && !axios.isCancel(error)) {
          setError('历史消息加载失败，请刷新重试')
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void loadHistory()
    return () => controller.abort()
  }, [sessionId, requestedPage, refreshToken, onLoaded])

  return (
    <Card
      title="会话历史"
      extra={
        <Button
          disabled={loading}
          onClick={() => setRefreshToken((value) => value + 1)}
        >
          刷新历史
        </Button>
      }
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {loading && <Spin />}

        {error && <Alert type="error" showIcon message={error} />}

        {result?.messages.length === 0 && (
          <Empty description="会话中还没有问答，可以开始提问" />
        )}

        {result?.messages.map((item) => (
          <Card
            key={item.message_id}
            size="small"
            title={`第 ${item.message_no} 次问答`}
            extra={
              <ExportAnswerButton result={item} />
            }
          >
            <p><strong>问题：</strong>{item.question}</p>

            {item.status === 'generated' ? (
              <CitedAnswer
                answer={item.answer}
                references={item.references}
                onReadReference={onReadReference}
              />
            ) : (
              <Alert
                type="warning"
                showIcon
                message={item.answer}
              />
            )}

            {item.warnings.map((warning, index) => (
              <Alert
                key={`${item.message_id}-${index}`}
                type="info"
                message={warning}
                style={{ marginTop: 12 }}
              />
            ))}

            <p style={{ color: '#666', marginBottom: 0 }}>
              保存时间：{new Date(item.created_at).toLocaleString()}
            </p>
          </Card>
        ))}

        {result && result.total > 0 && (
          <Pagination
            current={result.page}
            pageSize={PAGE_SIZE}
            total={result.total}
            showSizeChanger={false}
            onChange={setRequestedPage}
          />
        )}
      </Space>
    </Card>
  )
}