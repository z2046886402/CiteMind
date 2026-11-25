/**
 * 文献会话问答页面。
 *
 * 接收流式回答并展示临时文本；收到保存成功事件后，
 * 使用完整结果展示引用，并刷新会话列表和消息历史。
 */
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Space,
  Spin,
} from 'antd'

import { useCallback, useEffect, useRef, useState } from 'react'
import { askDocumentsStream } from '../../api/chat-stream'
import type {
  AnswerReference,
  DocumentChatResult,
} from '../../api/chat'
import CitedAnswer from './components/cited-answer'

import type { ChatSession } from '../../api/session'
import SessionPanel from './components/session-panel'
import MessageHistory from './components/message-history'

import type { RerankMethod } from '../../api/search'
import RerankSelect from '../../components/rerank-select'
import ReferencePreview from './components/reference-preview'
import ExportAnswerButton from './components/export-answer-button'
import RecommendedQuestions from './components/recommended-questions'
import {
  getChatNotice,
  stoppedChatNotice,
} from '../../utils/chat-notice'
import type { ChatNotice } from '../../utils/chat-notice'
interface QuestionFormValues {
  question: string

  /** 本轮问答使用的重排方式。 */
  rerank_method: RerankMethod
}

export default function ChatPage() {
  const [loading, setLoading] = useState(false)
  /** 正在接收的临时正文，尚未完成引用检查和保存确认。 */
  const [streamText, setStreamText] = useState('')

  /** 后端当前处理阶段，例如检索、生成和保存。 */
  const [streamStatus, setStreamStatus] = useState('')
  /** 统一展示失败、结果待确认和主动停止提示。 */
  const [notice, setNotice] = useState<ChatNotice | null>(
    null,
  )
  const [result, setResult] = useState<DocumentChatResult | null>(null)
  const [selectedReference, setSelectedReference] =
    useState<AnswerReference | null>(null)

  const controllerRef = useRef<AbortController | null>(null)

  const [activeSession, setActiveSession] = useState<ChatSession | null>(null)
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [sessionRevision, setSessionRevision] = useState(0)
  const [historyRevision, setHistoryRevision] = useState(0)
  const [questionForm] = Form.useForm<QuestionFormValues>()

  useEffect(() => {
    // 取消客户端等待，不代表服务器中的模型调用立即停止。
    return () => controllerRef.current?.abort()
  }, [])

  /** 提交单轮问题，并清除上一轮回答和引用弹窗状态。 */
  /**
 * 提交当前会话的问题，接收临时片段并等待正式结果。
 *
 * 只有收到 done 才确认成功；失败时清除临时正文，
 * 并刷新历史记录，以核对后端是否已经保存消息。
 */
  async function handleAsk(
    values: QuestionFormValues,
  ): Promise<void> {
    if (
      !activeSession ||
      workspaceBusy ||
      controllerRef.current
    ) {
      return
    }

    const sessionId = activeSession.session_id
    const controller = new AbortController()

    controllerRef.current = controller

    setLoading(true)
    setNotice(null)
    setResult(null)
    setSelectedReference(null)
    setStreamText('')
    setStreamStatus('正在连接问答服务')

    try {
      const data = await askDocumentsStream(
        {
          question: values.question.trim(),
          top_k: 5,
          min_similarity: 0.3,
          rerank_method: values.rerank_method,
        },
        sessionId,
        {
          onStatus(message) {
            if (!controller.signal.aborted) {
              setStreamStatus(message)
            }
          },
          onDelta(content) {
            if (!controller.signal.aborted) {
              // 使用函数式更新，避免连续片段覆盖尚未渲染的内容。
              setStreamText((current) => current + content)
            }
          },
        },
        controller.signal,
      )

      if (controller.signal.aborted) {
        return
      }

      // 完整结果具有最终正文、引用和消息编号，替换临时内容。
      setStreamText('')
      setStreamStatus('')
      setResult(data)
      // 同步当前会话标题；列表仍由原有刷新流程重新查询。
      if (typeof data.session_name === 'string') {
        const sessionName = data.session_name

        setActiveSession((current) => {
          if (
            !current ||
            current.session_id !== data.session_id
          ) {
            return current
          }

          return {
            ...current,
            session_name: sessionName,
          }
        })
      }
      setHistoryRevision((value) => value + 1)
      setSessionRevision((value) => value + 1)

      // 只清空问题，保留用户选择，方便连续比较两种方式。
      questionForm.resetFields(['question'])
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        return
      }

      const nextNotice = getChatNotice(error)

      setNotice(nextNotice)
      setStreamText('')
      setStreamStatus('')

      if (nextNotice.clearSession) {
        // 只清除本次请求对应的会话，避免影响其他会话。
        setActiveSession((current) =>
          current?.session_id === sessionId
            ? null
            : current,
        )

        setSessionRevision((value) => value + 1)
      } else if (nextNotice.checkHistory) {
        // 保存结果不明确时查询历史，不自动重新发送问题。
        setHistoryRevision((value) => value + 1)
        setSessionRevision((value) => value + 1)
      }
    } finally {
      // 旧请求不能清理用户后来发起的新请求状态。
      if (controllerRef.current === controller) {
        controllerRef.current = null

        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }
  }

  /**
 * 停止接收当前回答，并恢复页面操作能力。
 *
 * 先解除当前请求引用，再触发取消，避免旧请求的清理逻辑
 * 影响用户随后提交的新请求。不清空问题输入，便于修改。
 *
 * 浏览器取消不保证后端立即停止；历史刷新仅反映查询时的状态。
 */
  /**
   * 停止接收当前响应，并查询已有历史。
   * 不将主动停止当作请求失败，也不承诺后端立即终止。
   */
  function handleStopAnswer(): void {
    const controller = controllerRef.current

    if (!controller || controller.signal.aborted) {
      return
    }

    controllerRef.current = null
    controller.abort()

    setLoading(false)
    setStreamText('')
    setStreamStatus('')
    setResult(null)
    setSelectedReference(null)

    setNotice(stoppedChatNotice())

    setHistoryRevision((value) => value + 1)
    setSessionRevision((value) => value + 1)
  }
  /**
   * 在当前会话追加一次追问。
   *
   * 复用表单校验与提交流程，保留用户当前选择的重排方式。
   */
  function handleRecommendedQuestion(
    question: string,
  ): void {
    if (
      !activeSession ||
      loading ||
      workspaceBusy ||
      controllerRef.current
    ) {
      return
    }

    questionForm.setFieldValue('question', question)
    questionForm.submit()
  }
  /** 切换目标时清除旧回答与引用，避免跨会话显示。 */
  function handleSelectSession(session: ChatSession): void {
    if (controllerRef.current) {
      return
    }

    setActiveSession(session)
    setResult(null)
    setStreamText('')
    setStreamStatus('')
    setNotice(null)
    setSelectedReference(null)
    questionForm.resetFields()
  }

  /** 历史已展示新消息后，移除临时回答，避免重复展示。 */
  const handleHistoryLoaded = useCallback((messageIds: string[]) => {
    setResult((current) => {
      if (
        current?.message_id &&
        messageIds.includes(current.message_id)
      ) {
        return null
      }

      return current
    })
  }, [])


  /** 更新当前会话标题，不清空用户正在编辑的问题。 */
  function handleSessionRenamed(session: ChatSession): void {
    setActiveSession((current) =>
      current?.session_id === session.session_id ? session : current,
    )
  }

  /** 当前会话删除后，清除其回答、引用和输入状态。 */
  function handleSessionDeleted(sessionId: string): void {
    if (activeSession?.session_id !== sessionId) {
      return
    }

    setActiveSession(null)
    setResult(null)
    setStreamText('')
    setStreamStatus('')
    setNotice(null)
    setSelectedReference(null)
    questionForm.resetFields()
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>

      <SessionPanel
        activeId={activeSession?.session_id}
        disabled={loading || workspaceBusy}
        reloadToken={sessionRevision}
        onSelect={handleSelectSession}
        onBusyChange={setWorkspaceBusy}
        onRenamed={handleSessionRenamed}
        onDeleted={handleSessionDeleted}
      />

      <Card
        title={
          activeSession
            ? `文献问答：${activeSession.session_name}`
            : '请先选择或新建会话'
        }
      >
        <Alert
          type="info"
          showIcon
          message="通过关键词与向量共同检索当前账号的文献，再生成回答；点击引用编号可核对原文。"
          style={{ marginBottom: 20 }}
        />

        <Form<QuestionFormValues>
          form={questionForm}
          initialValues={{ rerank_method: 'rule' }}
          layout="vertical"
          disabled={loading || workspaceBusy || !activeSession}
          onFinish={handleAsk}
        >
          <Form.Item
            label="你的问题"
            name="question"
            rules={[
              {
                required: true,
                whitespace: true,
                message: '请输入问题',
              },
              {
                max: 1000,
                message: '问题不能超过 1000 个字符',
              },
            ]}
          >
            <Input.TextArea
              rows={3}
              maxLength={1000}
              showCount
              placeholder="例如：这篇研究采用了什么方法，主要结论是什么？"
            />
          </Form.Item>
          <Form.Item
            label="重排方式"
            name="rerank_method"
            rules={[
              { required: true, message: '请选择重排方式' },
            ]}
            extra="规则重排使用本地计算；模型重排会额外调用接口，可能增加费用和等待时间。"
          >
            <RerankSelect />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
            >
              生成回答
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {loading && (
        <Card
          title="正在生成回答"
          extra={
            <Button
              danger
              htmlType="button"
              onClick={handleStopAnswer}
            >
              停止接收
            </Button>
          }
        >
          <Space>
            <Spin size="small" />
            <span>{streamStatus || '正在处理，请稍候'}</span>
          </Space>

          {streamText && (
            <div
              style={{
                marginTop: 20,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                lineHeight: 1.8,
              }}
            >
              {streamText}
            </div>
          )}

          <p
            style={{
              marginBottom: 0,
              marginTop: 16,
              color: '#888',
            }}
          >
            回答完成后可点击引用编号核对原文。
          </p>
        </Card>
      )}

      {notice && (
        <Alert
          type={notice.type}
          showIcon
          message={notice.title}
          description={notice.description}
          action={
            notice.checkHistory && activeSession ? (
              <Button
                htmlType="button"
                size="small"
                disabled={loading || workspaceBusy}
                onClick={() => {
                  setHistoryRevision(
                    (value) => value + 1,
                  )
                  setSessionRevision(
                    (value) => value + 1,
                  )
                }}
              >
                刷新会话历史
              </Button>
            ) : undefined
          }
        />
      )}

      {result && (
        <>
          <Card
            title="本次问题"
            extra={
              <ExportAnswerButton result={result} />
            }
          >
            {result.question}
          </Card>

          {result.warnings.map((warning, index) => (
            <Alert
              key={`${index}-${warning}`}
              type="warning"
              showIcon
              message={warning}
            />
          ))}

          {result.status === 'generated' ? (
            <>
              <Card title="文献回答">
                <CitedAnswer
                  answer={result.answer}
                  references={result.references}
                  onReadReference={setSelectedReference}
                />
                <RecommendedQuestions
                  questions={result.recommended_questions}
                  disabled={loading || workspaceBusy}
                  onAsk={handleRecommendedQuestion}
                />
                <p style={{ marginBottom: 0, color: '#666' }}>
                  引用编号已通过格式检查，回答中的结论仍需核对原文。
                </p>
              </Card>

              <Card title="引用来源">
                <Space
                  direction="vertical"
                  style={{ width: '100%' }}
                >
                  {result.references.map((reference) => (
                    <Button
                      key={reference.citation_id}
                      type="link"
                      style={{
                        height: 'auto',
                        whiteSpace: 'normal',
                        textAlign: 'left',
                      }}
                      onClick={() => setSelectedReference(reference)}
                    >
                      [{reference.citation_id}] {reference.file_name}
                      （第 {reference.chunk_index} 块）
                    </Button>
                  ))}
                </Space>
              </Card>
            </>
          ) : (
            <Alert
              type="warning"
              showIcon
              message={
                result.status === 'no_evidence'
                  ? '未找到可用资料'
                  : '现有资料不足'
              }
              description={result.answer}
            />
          )}
        </>
      )}

      {activeSession && (
        <MessageHistory
          key={`${activeSession.session_id}:${historyRevision}`}
          sessionId={activeSession.session_id}
          onReadReference={setSelectedReference}
          onLoaded={handleHistoryLoaded}
          disabled={loading || workspaceBusy}
          onAskQuestion={handleRecommendedQuestion}
        />
      )}

      <Modal
        title={
          selectedReference
            ? `引用 [${selectedReference.citation_id}]：${selectedReference.file_name}`
            : '引用来源'
        }
        open={selectedReference !== null}
        width={900}
        onCancel={() => setSelectedReference(null)}
        footer={
          <Button onClick={() => setSelectedReference(null)}>
            关闭
          </Button>
        }
      >
        {selectedReference && (
          <ReferencePreview
            key={[
              selectedReference.document_id,
              selectedReference.start_char,
              selectedReference.end_char,
              selectedReference.citation_id,
            ].join(':')}
            reference={selectedReference}
          />
        )}
      </Modal>
    </Space>
  )
}