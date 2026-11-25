/**
 * 聊天栏底部输入区。
 *
 * 负责表单展示和校验，请求发送、停止接收仍由父页面处理。
 */
import { Button, Form, Input, Space } from 'antd'
import type { FormInstance } from 'antd'
import type { RerankMethod } from '../../../api/search'
import RerankSelect from '../../../components/rerank-select'

export interface QuestionFormValues {
  question: string
  rerank_method: RerankMethod
}

interface ChatComposerProps {
  form: FormInstance<QuestionFormValues>
  disabled: boolean
  loading: boolean
  onSubmit: (values: QuestionFormValues) => Promise<void>
  onStop: () => void
}

export default function ChatComposer({
  form,
  disabled,
  loading,
  onSubmit,
  onStop,
}: ChatComposerProps) {
  const rerankMethod = Form.useWatch('rerank_method', form)

  return (
    <section className="chat-composer" aria-label="问题输入区">
      <Form<QuestionFormValues>
        form={form}
        initialValues={{ rerank_method: 'rule' }}
        layout="vertical"
        disabled={disabled || loading}
        onFinish={onSubmit}
      >
        <Form.Item
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
            autoSize={{ minRows: 2, maxRows: 6 }}
            variant="borderless"
            onKeyDown={(event) => {
              // 组合键发送保留 Enter 换行，并避开中文输入法的候选确认事件。
              if (
                (event.ctrlKey || event.metaKey) &&
                event.key === 'Enter' &&
                !event.nativeEvent.isComposing &&
                !disabled &&
                !loading
              ) {
                event.preventDefault()
                form.submit()
              }
            }}
            maxLength={1000}
            aria-label="你的问题"
            placeholder="询问文献中的研究方法、实验结果或局限性……"
          />
        </Form.Item>

        <div className="chat-composer-toolbar">
          <Form.Item
            name="rerank_method"
            rules={[
              {
                required: true,
                message: '请选择重排方式',
              },
            ]}
          >
            <RerankSelect
              aria-label="重排方式"
              variant="borderless"
              style={{ minWidth: 124 }}
            />
          </Form.Item>

          <Space>
            <span className="chat-keyboard-hint">Ctrl / ⌘ + Enter 发送</span>
            {loading && (
              <Button htmlType="button" danger disabled={false} onClick={onStop}>
                停止接收
              </Button>
            )}

            <Button type="primary" htmlType="submit" loading={loading}>
              发送 ↑
            </Button>
          </Space>
        </div>
      </Form>
      <p className="chat-composer-note">
        {rerankMethod === 'model' ? '模型重排会增加费用与等待时间 · ' : ''}
        回答基于文献生成，请结合引用核对结论。
      </p>
    </section>
  )
}
