/**
 * 单轮文献问答页面。
 *
 * 提交问题、展示回答和引用，使用弹窗核对原文。
 * 当前不保存历史记录，不将前一次回答作为下一次提问的上下文。
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
import axios from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'
import { askDocuments } from '../../api/chat'
import type {
  AnswerReference,
  DocumentChatResult,
} from '../../api/chat'
import CitedAnswer from './components/cited-answer'

import type { ChatSession } from '../../api/session'
import SessionPanel from './components/session-panel'
import MessageHistory from './components/message-history'


interface QuestionFormValues {
  question: string
}

export default function ChatPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
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
  async function handleAsk(values: QuestionFormValues): Promise<void> {
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
    setResult(null)
    setSelectedReference(null)

    try {
      const data = await askDocuments(
        {
          question: values.question.trim(),
          top_k: 5,
          min_similarity: 0.3,
        },
        controller.signal, sessionId,
      )

      if (!controller.signal.aborted) {
        // 先展示刚返回的答案；历史加载成功后再去除重复项。
        setResult(data)
        setHistoryRevision((value) => value + 1)
        setSessionRevision((value) => value + 1)
        questionForm.resetFields()
      }
    } catch (error) {
      if (controller.signal.aborted || axios.isCancel(error)) {
        return
      }

      let description = '问答失败，请稍后重试'

      if (axios.isAxiosError<{ detail?: unknown }>(error)) {
        const detail = error.response?.data?.detail

        if (typeof detail === 'string') {
          description = detail
        } else if (error.code === 'ECONNABORTED') {
          description = '回答等待超时，请稍后重试'
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

  /** 切换目标时清除旧回答与引用，避免跨会话显示。 */
  function handleSelectSession(session: ChatSession): void {
    if (controllerRef.current) {
      return
    }

    setActiveSession(session)
    setResult(null)
    setError('')
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
    setError('')
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
          message="基于当前账号已建立索引的文献回答，点击引用编号可核对原文。"
          style={{ marginBottom: 20 }}
        />

        <Form<QuestionFormValues>
          form={questionForm}
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
        <Card>
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Spin />
            <p>正在检索文献并生成回答，请稍候……</p>
          </div>
        </Card>
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