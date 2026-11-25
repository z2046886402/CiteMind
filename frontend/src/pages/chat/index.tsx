/**
 * 文献会话问答页面。
 *
 * 接收流式回答并展示临时文本；收到保存成功事件后，
 * 使用完整结果展示引用，并刷新会话列表和消息历史。
 */
import { Alert, Button, Card, Form, Modal, Space, Spin } from 'antd'

import { useCallback, useEffect, useRef, useState } from 'react'
import { askDocumentsStream } from '../../api/chat-stream'
import type { AnswerReference, DocumentChatResult } from '../../api/chat'
import CitedAnswer from './components/cited-answer'

import { createSession } from '../../api/session'
import type { ChatSession } from '../../api/session'
import SessionPanel from './components/session-panel'
import MessageHistory from './components/message-history'

import ReferencePreview from './components/reference-preview'
import ExportAnswerButton from './components/export-answer-button'
import RecommendedQuestions from './components/recommended-questions'
import { getChatNotice, stoppedChatNotice } from '../../utils/chat-notice'
import type { ChatNotice } from '../../utils/chat-notice'
import ChatComposer from './components/chat-composer'
import type { QuestionFormValues } from './components/chat-composer'
import ChunkSourceTags from '../../components/chunk-source-tags'
import './index.css'

export default function ChatPage() {
  const [loading, setLoading] = useState(false)
  /** 正在接收的临时正文，尚未完成引用检查和保存确认。 */
  const [streamText, setStreamText] = useState('')

  /** 后端当前处理阶段，例如检索、生成和保存。 */
  const [streamStatus, setStreamStatus] = useState('')
  /** 统一展示失败、结果待确认和主动停止提示。 */
  const [notice, setNotice] = useState<ChatNotice | null>(null)
  const [result, setResult] = useState<DocumentChatResult | null>(null)
  const [selectedReference, setSelectedReference] = useState<AnswerReference | null>(null)

  const controllerRef = useRef<AbortController | null>(null)

  const [activeSession, setActiveSession] = useState<ChatSession | null>(null)
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [sessionRevision, setSessionRevision] = useState(0)
  const [historyRevision, setHistoryRevision] = useState(0)
  const [questionForm] = Form.useForm<QuestionFormValues>()
  const [referenceModalOpen, setReferenceModalOpen] = useState(false)

  const messageScrollRef = useRef<HTMLDivElement | null>(null)
  const messageContentRef = useRef<HTMLDivElement | null>(null)

  // 接近底部时跟随新增内容，向上滚动阅读时暂停跟随。
  const followTailRef = useRef(true)

  useEffect(() => {
    const content = messageContentRef.current

    if (!content || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => {
      const container = messageScrollRef.current

      if (container && followTailRef.current) {
        container.scrollTop = container.scrollHeight
      }
    })

    observer.observe(content)

    return () => observer.disconnect()
  }, [])

  /** 点击引用时先在右侧显示摘录，原文预览按需展开。 */
  function handleReadReference(reference: AnswerReference): void {
    setSelectedReference(reference)
    setReferenceModalOpen(false)
  }
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
  async function handleAsk(values: QuestionFormValues): Promise<void> {
    if (workspaceBusy || controllerRef.current) {
      return
    }
    followTailRef.current = true
    let sessionId = activeSession?.session_id ?? null
    const controller = new AbortController()

    controllerRef.current = controller

    setLoading(true)
    setNotice(null)
    setResult(null)
    setSelectedReference(null)
    setStreamText('')
    setStreamStatus('正在连接问答服务')

    try {
      // 首次提问按需创建会话；复用同一取消信号及请求锁，防止重复创建或跨会话提交。
      if (!sessionId) {
        setStreamStatus('正在创建研究会话')
        const session = await createSession('新会话', controller.signal, true)
        if (controller.signal.aborted) return
        sessionId = session.session_id
        setActiveSession(session)
        setSessionRevision((value) => value + 1)
      }

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
          if (!current || current.session_id !== data.session_id) {
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

      // 创建结果不明时先刷新列表核对，禁止自动重试，以免创建重复会话。
      if (!sessionId) {
        setNotice({
          type: 'warning',
          title: '会话创建未完成',
          description: '请刷新左侧会话列表核对创建结果，再选择会话或重新提问。',
          checkHistory: false,
          clearSession: false,
        })
        setStreamText('')
        setStreamStatus('')
        setSessionRevision((value) => value + 1)
        return
      }

      const nextNotice = getChatNotice(error)

      setNotice(nextNotice)
      setStreamText('')
      setStreamStatus('')

      if (nextNotice.clearSession) {
        // 只清除本次请求对应的会话，避免影响其他会话。
        setActiveSession((current) =>
          current?.session_id === sessionId ? null : current,
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
  function handleRecommendedQuestion(question: string): void {
    if (!activeSession || loading || workspaceBusy || controllerRef.current) {
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
    followTailRef.current = true
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
      if (current?.message_id && messageIds.includes(current.message_id)) {
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
    <div className={`chat-workspace${selectedReference ? ' has-reference' : ''}`}>
      {/* 左侧：会话管理。 */}
      <aside className="chat-session-pane" aria-label="会话列表">
        <SessionPanel
          activeId={activeSession?.session_id}
          disabled={loading || workspaceBusy}
          reloadToken={sessionRevision}
          onSelect={handleSelectSession}
          onBusyChange={setWorkspaceBusy}
          onRenamed={handleSessionRenamed}
          onDeleted={handleSessionDeleted}
        />
      </aside>

      {/* 中间：标题、消息滚动区和底部输入区。 */}
      <main className="chat-main-pane">
        <header className="chat-main-header">
          <div>
            <h2 title={activeSession?.session_name}>
              {activeSession?.session_name ?? '文献研究助手'}
            </h2>

            <span>从文献出发，让每一个回答都有据可循</span>
          </div>
        </header>

        <div
          className="chat-message-scroll"
          ref={messageScrollRef}
          onScroll={(event) => {
            const element = event.currentTarget

            followTailRef.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < 80
          }}
        >
          <div className="chat-message-content" ref={messageContentRef}>
            {!activeSession && (
              <section className="chat-welcome">
                <span className="chat-welcome-mark" aria-hidden="true">
                  C.
                </span>
                <span className="chat-eyebrow">CITEMIND · RESEARCH WORKSPACE</span>
                <h1>读懂文献，连接想法。</h1>
                <p>
                  提炼研究方法、对比实验结果，或从一个问题开始探索。
                  <br />
                  直接在下方输入问题，即可开始；也可以先选一个研究方向。
                </p>
                <div className="chat-welcome-topics">
                  {[
                    {
                      label: '研究方法',
                      question: '请总结文献采用的主要研究方法，并说明各方法的作用。',
                    },
                    {
                      label: '实验结论',
                      question: '文献得出了哪些主要实验结论？请结合数据和引用说明。',
                    },
                    {
                      label: '文献对比',
                      question: '请比较已上传文献的研究方法、主要结论与局限性。',
                    },
                  ].map(({ label, question }) => (
                    <Button
                      key={label}
                      disabled={loading || workspaceBusy}
                      onClick={() => {
                        // 示例仅填入草稿，由用户确认发送，避免点击方向就触发模型费用。
                        questionForm.setFieldValue('question', question)
                        questionForm.getFieldInstance('question')?.focus()
                      }}
                    >
                      {label} <span aria-hidden="true">↗</span>
                    </Button>
                  ))}
                </div>
              </section>
            )}

            {activeSession && (
              <MessageHistory
                key={`${activeSession.session_id}:${historyRevision}`}
                sessionId={activeSession.session_id}
                onReadReference={handleReadReference}
                onLoaded={handleHistoryLoaded}
                disabled={loading || workspaceBusy}
                onAskQuestion={handleRecommendedQuestion}
              />
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
                        setHistoryRevision((value) => value + 1)
                        setSessionRevision((value) => value + 1)
                      }}
                    >
                      刷新历史
                    </Button>
                  ) : undefined
                }
              />
            )}

            {loading && (
              <Card className="chat-live-answer" title="CiteMind 正在思考">
                <Space>
                  <Spin size="small" />
                  <span>{streamStatus || '正在处理，请稍候'}</span>
                </Space>

                {streamText && <div className="chat-stream-text">{streamText}</div>}
              </Card>
            )}

            {result && (
              <>
                <div className="chat-question-bubble">{result.question}</div>
                <div className="chat-answer-heading">
                  <span className="chat-assistant-mark">C.</span>
                  <strong>CiteMind</strong>
                  <ExportAnswerButton result={result} />
                </div>

                {result.warnings.map((warning, index) => (
                  <Alert
                    key={`${index}-${warning}`}
                    type="warning"
                    showIcon
                    message={warning}
                  />
                ))}

                {result.status === 'generated' ? (
                  <section className="chat-answer-body">
                    <CitedAnswer
                      answer={result.answer}
                      references={result.references}
                      onReadReference={handleReadReference}
                    />

                    <RecommendedQuestions
                      questions={result.recommended_questions}
                      disabled={loading || workspaceBusy}
                      onAsk={handleRecommendedQuestion}
                    />
                  </section>
                ) : (
                  <Alert
                    type="warning"
                    showIcon
                    message={
                      result.status === 'no_evidence' ? '未找到可用资料' : '现有资料不足'
                    }
                    description={result.answer}
                  />
                )}
              </>
            )}
          </div>
        </div>

        <ChatComposer
          form={questionForm}
          conversationKey={activeSession?.session_id ?? 'new-conversation'}
          disabled={workspaceBusy}
          loading={loading}
          onSubmit={handleAsk}
          onStop={handleStopAnswer}
        />
      </main>

      {/* 右侧：当前选中的引用及原文入口。 */}
      <aside className="chat-reference-pane" aria-label="引用来源">
        <Card
          title="引用来源"
          extra={
            selectedReference ? (
              <Button
                type="text"
                size="small"
                onClick={() => {
                  setSelectedReference(null)
                  setReferenceModalOpen(false)
                }}
              >
                关闭
              </Button>
            ) : undefined
          }
        >
          {selectedReference ? (
            <>
              <h3 className="chat-reference-name">{selectedReference.file_name}</h3>

              <ChunkSourceTags
                pageNumbers={selectedReference.page_numbers}
                containsTable={selectedReference.contains_table}
              />

              <p>
                引用 [{selectedReference.citation_id}]{' · '}第{' '}
                {selectedReference.chunk_index} 块
              </p>

              <pre className="chat-reference-text">{selectedReference.content}</pre>

              <Button block onClick={() => setReferenceModalOpen(true)}>
                展开查看原文
              </Button>
            </>
          ) : (
            <p className="chat-source-hint">点击回答中的引用编号，查看文献来源。</p>
          )}
        </Card>
      </aside>

      {/* 展开窗口继续复用既有的引用文本与 PDF 原文预览。 */}
      <Modal
        title={
          selectedReference
            ? `引用 [${selectedReference.citation_id}]：${selectedReference.file_name}`
            : '引用来源'
        }
        open={referenceModalOpen && selectedReference !== null}
        width={1100}
        onCancel={() => setReferenceModalOpen(false)}
        footer={<Button onClick={() => setReferenceModalOpen(false)}>关闭</Button>}
      >
        {selectedReference && referenceModalOpen && (
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
    </div>
  )
}
