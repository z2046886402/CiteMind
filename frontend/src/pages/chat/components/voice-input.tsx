/** 麦克风入口：显式点击才启动，仅将识别结果交给输入框，不发送问答。 */
import { Alert, Button, Tooltip } from 'antd'
import { useEffect, useRef, useState } from 'react'
import {
  getRecognitionConstructor,
  SpeechInputSession,
} from '../../../utils/speech-input'
import type { VoicePhase } from '../../../utils/speech-input'

interface VoiceInputProps {
  disabled: boolean
  conversationKey: string
  onTranscript: (text: string) => void
  onBusyChange: (busy: boolean) => void
}

export default function VoiceInput(props: VoiceInputProps) {
  const { disabled, conversationKey } = props
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const propsRef = useRef(props)
  propsRef.current = props
  const ownerRef = useRef(conversationKey)
  const sessionRef = useRef<SpeechInputSession | null>(null)
  const Constructor = getRecognitionConstructor()
  const active = phase !== 'idle'

  useEffect(() => {
    // 在切换会话或输入区被禁用时取消，避免将迟到的识别文字写入新会话。
    sessionRef.current?.cancel()
    propsRef.current.onBusyChange(false)
    setError('')
    return () => {
      sessionRef.current?.cancel(false)
      propsRef.current.onBusyChange(false)
    }
  }, [conversationKey, disabled])

  function handleClick(): void {
    if (!Constructor || disabled) return
    setError('')
    if (active) {
      sessionRef.current?.stop()
      return
    }
    if (!sessionRef.current) {
      sessionRef.current = new SpeechInputSession({
        onPhase: (next) => {
          setPhase(next)
          propsRef.current.onBusyChange(next !== 'idle')
        },
        onPreview: setPreview,
        onTranscript: (text) => {
          if (
            ownerRef.current === propsRef.current.conversationKey &&
            !propsRef.current.disabled
          ) {
            propsRef.current.onTranscript(text)
          }
        },
        onError: setError,
      })
    }
    ownerRef.current = conversationKey
    sessionRef.current.start(Constructor)
  }

  const label =
    phase === 'starting'
      ? '正在启动'
      : phase === 'stopping'
        ? '正在识别'
        : active
          ? '结束录音'
          : '语音输入'

  return (
    <div className="chat-voice-control">
      <Tooltip
        title={
          Constructor
            ? '中文语音输入，结束后可编辑再发送'
            : '当前浏览器不支持语音识别，或页面不是安全环境；请使用文字输入'
        }
      >
        <span>
          <Button
            htmlType="button"
            className="chat-voice-button"
            danger={active}
            disabled={
              disabled || !Constructor || phase === 'starting' || phase === 'stopping'
            }
            aria-label={label}
            aria-pressed={active}
            onClick={handleClick}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
            </svg>
            {label}
          </Button>
        </span>
      </Tooltip>
      {active && (
        <div className="chat-voice-preview" role="status" aria-live="polite">
          <span className="chat-voice-dot" />
          {preview ||
            (phase === 'starting'
              ? '请允许麦克风权限…'
              : phase === 'stopping'
                ? '正在整理识别文字…'
                : '正在聆听，请开始说话…')}
        </div>
      )}
      {error && (
        <Alert
          className="chat-voice-error"
          type="warning"
          showIcon
          message={error}
          closable
          onClose={() => setError('')}
        />
      )}
    </div>
  )
}
