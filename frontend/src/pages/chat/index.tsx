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
import ChunkSourceTags from '../../components/chunk-source-tags'

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
  const [error, setError] = useState('')
  /** 主动停止后的提示，与请求失败信息分开展示。 */
  const [stopNotice, setStopNotice] = useState('')
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
    setError('')
    setStopNotice('')
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

      setHistoryRevision((value) => value + 1)
      setSessionRevision((value) => value + 1)

      // 只清空问题，保留用户选择，方便连续比较两种方式。
      questionForm.resetFields(['question'])
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        return
      }

      const description =
        error instanceof Error
          ? error.message
          : '流式问答处理失败'

      setError(
        `${description}。请先核对会话历史，再决定是否重试。`,
      )

      // 未确认成功的文本不能继续作为正式回答展示。
      setStreamText('')
      setStreamStatus('')

      // 后端可能已提交消息，但完成通知未能到达浏览器。
      setHistoryRevision((value) => value + 1)
      setSessionRevision((value) => value + 1)
    } finally {
      // 只有仍占用当前引用的请求，才能清理页面请求状态。
      // 用户停止后可能已经发起新请求，旧请求不得覆盖新状态。
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
    setError('')

    setStopNotice(
      '已停止接收回答。请核对会话历史；如果后端仍在处理，可稍后再次刷新历史。',
    )

    // 回答可能已保存，但浏览器尚未收到完成通知。
    setHistoryRevision((value) => value + 1)
    setSessionRevision((value) => value + 1)
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
    setError('')
    setStopNotice('')
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
    setError('')
    setStopNotice('')
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
              停止回答
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

      {stopNotice && (
        <Alert
          type="info"
          showIcon
          message="已停止接收"
          description={stopNotice}
        />
      )}
      {error && <Alert type="error" showIcon message={error} />}

      {result && (
        <>
          <Card title="本次问题">
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
          <>
            <p>
              文献 ID：{selectedReference.document_id}；
              分块编号：{selectedReference.chunk_index}
            </p>

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
              {selectedReference.content}
              <ChunkSourceTags
                pageNumbers={selectedReference.page_numbers}
                containsTable={selectedReference.contains_table}
              />
            </pre>

            <p>
              解析后全文字符范围：
              [{selectedReference.start_char}, {selectedReference.end_char})
            </p>
          </>
        )}
      </Modal>
    </Space>
  )
}