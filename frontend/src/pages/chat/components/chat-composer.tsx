/**
 * 聊天栏底部输入区。
 *
 * 负责表单展示和校验，请求发送、停止接收仍由父页面处理。
 */
import { Button, Form, Input, Space } from 'antd'
import type { FormInstance } from 'antd'
import { useEffect, useRef, useState } from 'react'
import VoiceInput from './voice-input'
import type { RerankMethod } from '../../../api/search'
import RerankSelect from '../../../components/rerank-select'

export interface QuestionFormValues {
  question: string
  rerank_method: RerankMethod
}

interface ChatComposerProps {
  form: FormInstance<QuestionFormValues>
  conversationKey: string
  disabled: boolean
  loading: boolean
  onSubmit: (values: QuestionFormValues) => Promise<void>
  onStop: () => void
}

export default function ChatComposer({
  form,
  conversationKey,
  disabled,
  loading,
  onSubmit,
  onStop,
}: ChatComposerProps) {
  const rerankMethod = Form.useWatch('rerank_method', form)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const voiceBusyRef = useRef(false)
  const [voiceNotice, setVoiceNotice] = useState('')

  useEffect(() => {
    setVoiceNotice('')
  }, [conversationKey])

  /** 向最新草稿追加识别内容；保留原有文字，并遵守问题长度限制。 */
  function handleTranscript(text: string): void {
    const value: unknown = form.getFieldValue('question')
    const current = typeof value === 'string' ? value : ''
    const separator = current ? '\n' : ''
    const remaining = Math.max(0, 1000 - current.length - separator.length)
    if (!remaining) {
      setVoiceNotice('输入已达到长度上限，本次语音未插入；请先精简问题后重试。')
      return
    }
    form.setFieldValue('question', current + separator + text.slice(0, remaining))
    setVoiceNotice(
      text.length > remaining ? '识别文字已按 1000 字符上限截取，请检查后发送。' : '',
    )
    form.getFieldInstance('question')?.focus()
  }

  return (
    <section className="chat-composer" aria-label="问题输入区">
      <Form<QuestionFormValues>
        form={form}
        initialValues={{ rerank_method: 'rule' }}
        layout="vertical"
        disabled={disabled || loading}
        onFinish={(values) => {
          // 等待识别草稿落入表单后再允许发送，避免提交不完整问题。
          if (!voiceBusyRef.current) return onSubmit(values)
        }}
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
                !loading &&
                !voiceBusyRef.current
              ) {
                event.preventDefault()
                form.submit()
              }
            }}
            disabled={disabled || loading || voiceBusy}
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
            <VoiceInput
              disabled={disabled || loading}
              conversationKey={conversationKey}
              onTranscript={handleTranscript}
              onBusyChange={(busy) => {
                voiceBusyRef.current = busy
                setVoiceBusy(busy)
                if (busy) setVoiceNotice('')
              }}
            />
            {loading && (
              <Button htmlType="button" danger disabled={false} onClick={onStop}>
                停止接收
              </Button>
            )}

            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              disabled={voiceBusy}
            >
              发送 ↑
            </Button>
          </Space>
        </div>
      </Form>
      {voiceNotice && (
        <p className="chat-voice-notice" role="status">
          {voiceNotice}
        </p>
      )}
      <p className="chat-composer-note">
        {rerankMethod === 'model' ? '模型重排会增加费用与等待时间 · ' : ''}
        回答基于文献生成，请结合引用核对结论。
      </p>
    </section>
  )
}
