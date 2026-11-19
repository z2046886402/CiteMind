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
import { useEffect, useRef, useState } from 'react'
import { askDocuments } from '../../api/chat'
import type {
  AnswerReference,
  DocumentChatResult,
} from '../../api/chat'
import CitedAnswer from './components/cited-answer'

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

  useEffect(() => {
    // 取消客户端等待，不代表服务器中的模型调用立即停止。
    return () => controllerRef.current?.abort()
  }, [])

  /** 提交单轮问题，并清除上一轮回答和引用弹窗状态。 */
  async function handleAsk(values: QuestionFormValues): Promise<void> {
    if (controllerRef.current) {
      return
    }

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
        controller.signal,
      )

      if (!controller.signal.aborted) {
        setResult(data)
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

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title="文献问答">
        <Alert
          type="info"
          showIcon
          message="基于当前账号已建立索引的文献回答，点击引用编号可核对原文。"
          style={{ marginBottom: 20 }}
        />

        <Form<QuestionFormValues>
          layout="vertical"
          disabled={loading}
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