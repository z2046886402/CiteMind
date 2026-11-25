/**
 * 分页展示已保存的会话消息。
 *
 * 默认打开最新一页，页内按消息序号升序显示。
 * 切换会话或离开页面时取消旧查询。
 */
import { Alert, Button, Pagination, Spin } from 'antd'
import axios from 'axios'
import { useEffect, useState } from 'react'
import { getMessages } from '../../../api/session'
import type { AnswerReference } from '../../../api/chat'
import type { MessageListResult } from '../../../api/session'
import CitedAnswer from './cited-answer'
import ExportAnswerButton from './export-answer-button'
import RecommendedQuestions from './recommended-questions'

const PAGE_SIZE = 10

interface MessageHistoryProps {
  sessionId: string
  onReadReference: (reference: AnswerReference) => void
  onLoaded: (messageIds: string[]) => void
  disabled: boolean
  onAskQuestion: (question: string) => void
}

export default function MessageHistory({
  sessionId,
  onReadReference,
  onLoaded,
  disabled,
  onAskQuestion,
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
        const firstPage = await getMessages(sessionId, 1, PAGE_SIZE, controller.signal)

        const lastPage = Math.max(1, Math.ceil(firstPage.total / PAGE_SIZE))
        const targetPage =
          requestedPage === 0 ? lastPage : Math.min(requestedPage, lastPage)

        const data =
          targetPage === 1
            ? firstPage
            : await getMessages(sessionId, targetPage, PAGE_SIZE, controller.signal)

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
    <section className="chat-history" aria-label="会话消息">
      <div className="chat-history-toolbar">
        <span>文献问答</span>
        <Button
          type="text"
          size="small"
          disabled={loading}
          onClick={() => setRefreshToken((value) => value + 1)}
        >
          刷新历史
        </Button>
      </div>
      {loading && (
        <div className="chat-history-loading">
          <Spin />
        </div>
      )}
      {error && <Alert type="error" showIcon message={error} />}
      {result?.messages.length === 0 && (
        <div className="chat-empty-conversation">
          <span className="chat-welcome-mark" aria-hidden="true">
            C.
          </span>
          <h2>有什么想从文献中了解的？</h2>
          <p>在下方输入问题，开始这一次研究。</p>
        </div>
      )}
      {result?.messages.map((item) => (
        <article
          key={item.message_id}
          className="chat-exchange"
          aria-label={`第 ${item.message_no} 次问答`}
        >
          <div className="chat-question-bubble">{item.question}</div>
          <div className="chat-answer-heading">
            <span className="chat-assistant-mark" aria-hidden="true">
              C.
            </span>
            <strong>CiteMind</strong>
            <span className="chat-answer-time">
              {new Date(item.created_at).toLocaleString()}
            </span>
            <ExportAnswerButton result={item} />
          </div>
          <div className="chat-answer-body">
            {item.status === 'generated' ? (
              <CitedAnswer
                answer={item.answer}
                references={item.references}
                onReadReference={onReadReference}
              />
            ) : (
              <Alert type="warning" showIcon message={item.answer} />
            )}
            {item.status === 'generated' && (
              <RecommendedQuestions
                questions={item.recommended_questions}
                disabled={disabled}
                onAsk={onAskQuestion}
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
          </div>
        </article>
      ))}
      {result && result.total > PAGE_SIZE && (
        <Pagination
          size="small"
          current={result.page}
          pageSize={PAGE_SIZE}
          total={result.total}
          showSizeChanger={false}
          onChange={setRequestedPage}
        />
      )}
    </section>
  )
}
