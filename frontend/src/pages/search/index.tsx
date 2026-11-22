/**
 * 文献混合检索页面。
 *
 * 收集检索参数，展示关键词与向量融合后的相关片段。
 * 最终按重排分数排序，混合召回分数和余弦相似度分别展示。
 * 结果内容按普通文本渲染，不执行文献中的 HTML。
 */
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Space,
  Spin,
  Tag,
} from 'antd'
import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import { searchDocuments } from '../../api/search'
import type {
  SemanticSearchParams,
  SemanticSearchResult,
} from '../../api/search'
import RerankSelect from '../../components/rerank-select'
export default function SearchPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<SemanticSearchResult | null>(null)

  // 记录当前请求，防止重复提交，并支持页面卸载时取消等待。
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => controllerRef.current?.abort()
  }, [])

  /** 提交检索参数，并将成功、失败和加载状态分别管理。 */
  async function handleSearch(
    values: SemanticSearchParams,
  ): Promise<void> {
    if (controllerRef.current) {
      return
    }

    const controller = new AbortController()
    controllerRef.current = controller

    setLoading(true)
    setError('')
    setResult(null)

    try {
      const data = await searchDocuments(
        {
          ...values,
          question: values.question.trim(),
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

      let description = '检索失败，请检查后端服务或稍后重试'

      if (axios.isAxiosError<{ detail?: unknown }>(error)) {
        const detail = error.response?.data?.detail

        if (typeof detail === 'string') {
          description = detail
        } else if (error.code === 'ECONNABORTED') {
          description = '检索等待超时，请稍后重试'
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
      <Card title="文献混合检索">
        <Alert
          type="info"
          showIcon
          message="使用关键词与向量共同检索当前账号的文献；排序分数和相似度均不代表内容正确率。"
          style={{ marginBottom: 20 }}
        />

        <Form<SemanticSearchParams>
          layout="vertical"
          disabled={loading}
          initialValues={{
            top_k: 5,
            min_similarity: 0,
            rerank_method: 'rule',
          }}
          onFinish={handleSearch}
        >
          <Form.Item
            label="检索问题"
            name="question"
            rules={[
              {
                required: true,
                whitespace: true,
                message: '请输入检索问题',
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
              placeholder="例如：如何利用深度学习判断鱼类摄食强度？"
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
          <Space align="start" wrap>
            <Form.Item
              label="最多返回片段数"
              name="top_k"
              rules={[
                {
                  required: true,
                  type: 'integer',
                  min: 1,
                  max: 20,
                  message: '请输入 1—20 的整数',
                },
              ]}
            >
              <InputNumber min={1} max={20} precision={0} />
            </Form.Item>

            <Form.Item
              label="最低余弦相似度"
              name="min_similarity"
              extra="最终片段均需满足此阈值；阈值越高，返回结果可能越少。"
              rules={[
                {
                  required: true,
                  type: 'number',
                  min: -1,
                  max: 1,
                  message: '请输入 -1 至 1 之间的数值',
                },
              ]}
            >
              <InputNumber min={-1} max={1} step={0.05} />
            </Form.Item>
          </Space>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
            >
              检索文献
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {loading && (
        <Card>
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Spin />
            <p>正在查找相关文献片段……</p>
          </div>
        </Card>
      )}

      {error && <Alert type="error" showIcon message={error} />}

      {result && (
        <>
          <Card title="本次检索">
            <p>{result.question}</p>
            <span>返回 {result.returned_count} 个相关片段</span>
          </Card>

          {result.warnings.map((warning, index) => (
            <Alert
              key={`${index}-${warning}`}
              type="warning"
              showIcon
              message={warning}
            />
          ))}

          {result.items.length === 0 && (
            <Card>
              <Empty description="暂无匹配片段，可调整问题或最低相似度" />
            </Card>
          )}

          {result.items.map((item, index) => (
            <Card
              key={`${item.document_id}-${item.chunk_index}`}
              title={`${index + 1}. ${item.file_name}`}
              extra={<Tag>第 {item.chunk_index} 块</Tag>}
            >
              <Space wrap style={{ marginBottom: 12 }}>
                <Tag color="blue">
                  余弦相似度：{item.cosine_similarity.toFixed(4)}
                </Tag>
                <span>
                  混合召回分数：{item.score.toFixed(4)}
                </span>

                {item.rerank_score != null && (
                  <Tag color="purple">
                    {item.rerank_method === 'model' ? '模型' : '规则'}
                    重排分数：{item.rerank_score.toFixed(4)}
                  </Tag>
                )}
                <span>文献 ID：{item.document_id}</span>
              </Space>

              <pre
                style={{
                  margin: 0,
                  padding: 16,
                  maxHeight: 280,
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  background: '#fafafa',
                  borderRadius: 6,
                  fontFamily: 'inherit',
                  lineHeight: 1.8,
                }}
              >
                {item.content}
              </pre>

              <p style={{ marginBottom: 0, color: '#666' }}>
                解析后全文字符范围：
                [{item.start_char}, {item.end_char})，结束位置不包含在内。
              </p>
            </Card>
          ))}
        </>
      )}
    </Space>
  )
}