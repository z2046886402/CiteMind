/** 浏览器语音识别适配层：隔离兼容类型、超时控制及过期回调。 */
interface RecognitionResult {
  readonly length: number
  readonly [index: number]: { readonly transcript: string }
}

interface RecognitionEvent {
  readonly results: {
    readonly length: number
    readonly [index: number]: RecognitionResult
  }
}

export interface BrowserRecognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onstart: (() => void) | null
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type RecognitionConstructor = new () => BrowserRecognition
export type VoicePhase = 'idle' | 'starting' | 'listening' | 'stopping'

interface SpeechCallbacks {
  onPhase: (phase: VoicePhase) => void
  onPreview: (text: string) => void
  onTranscript: (text: string) => void
  onError: (message: string) => void
}

/** 同时兼容标准名称和 Chromium 前缀；不支持时保留正常文字输入。 */
export function getRecognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === 'undefined' || !window.isSecureContext) return undefined
  const browser = window as Window & {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition
}

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': '麦克风权限被拒绝，请在浏览器站点设置中允许麦克风后重试。',
  'service-not-allowed': '浏览器未允许语音识别服务，请检查浏览器设置或使用文字输入。',
  'audio-capture': '未找到可用麦克风，请检查设备连接及系统麦克风权限。',
  'no-speech': '没有识别到语音，请靠近麦克风后重试。',
  network: '语音识别服务连接失败，请检查网络或使用文字输入。',
  'language-not-supported': '当前语音服务不支持中文识别，请使用文字输入。',
  aborted: '语音识别已中断，可以重新开始或使用文字输入。',
}

/**
 * 管理一次识别过程。停止时等待末尾结果，取消时丢弃结果并解除回调。
 * 结果事件包含整次会话快照，每次重建全文，避免临时结果被重复追加。
 */
export class SpeechInputSession {
  private recognition: BrowserRecognition | null = null
  private text = ''
  private phase: VoicePhase = 'idle'
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly callbacks: SpeechCallbacks) {}

  private setPhase(phase: VoicePhase): void {
    this.phase = phase
    this.callbacks.onPhase(phase)
  }

  private clearTimer(): void {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  /** 解除事件后再取消，确保迟到的 onend 不会写入其他会话。 */
  private release(): void {
    this.clearTimer()
    const current = this.recognition
    this.recognition = null
    if (!current) return
    current.onstart = current.onresult = current.onerror = current.onend = null
    try {
      current.abort()
    } catch {
      /* 某些实现对已结束实例再次取消会抛错。 */
    }
  }

  private finish(error?: string): void {
    const text = this.text.trim()
    this.release()
    this.text = ''
    this.setPhase('idle')
    this.callbacks.onPreview('')
    // 已识别的内容保留为草稿，错误不会导致已有文字丢失。
    if (text) this.callbacks.onTranscript(text)
    if (error) this.callbacks.onError(error)
    else if (!text) this.callbacks.onError('没有识别到文字，请重试或直接输入。')
  }

  start(Constructor: RecognitionConstructor): void {
    if (this.recognition) return
    this.text = ''
    try {
      const recognition = new Constructor()
      this.recognition = recognition
      recognition.lang = 'zh-CN'
      recognition.continuous = true
      recognition.interimResults = true
      recognition.onstart = () => {
        if (this.recognition !== recognition) return
        this.clearTimer()
        this.setPhase('listening')
        // 单次最多一分钟，自动停止后仍等待尾部识别结果。
        this.timer = setTimeout(() => this.stop(), 60000)
      }
      recognition.onresult = (event) => {
        if (this.recognition !== recognition) return
        const parts: string[] = []
        for (let index = 0; index < event.results.length; index++) {
          const result = event.results[index]
          if (result?.length) parts.push(result[0].transcript)
        }
        this.text = parts.join(' ').trim()
        this.callbacks.onPreview(this.text.slice(0, 1000))
        if (this.text.length >= 1000) this.stop()
      }
      recognition.onerror = (event) => {
        if (this.recognition !== recognition) return
        this.finish(ERROR_MESSAGES[event.error] ?? '语音识别失败，请重试或使用文字输入。')
      }
      recognition.onend = () => {
        if (this.recognition === recognition) this.finish()
      }
      this.setPhase('starting')
      this.timer = setTimeout(
        () => this.finish('语音服务启动超时，请检查麦克风权限或网络。'),
        15000,
      )
      recognition.start()
    } catch {
      this.finish('无法启动语音识别，请检查麦克风权限及浏览器支持情况。')
    }
  }

  stop(): void {
    if (!this.recognition || this.phase === 'stopping') return
    this.clearTimer()
    this.setPhase('stopping')
    this.timer = setTimeout(
      () => this.finish('语音服务未及时结束，已保留当前识别草稿。'),
      5000,
    )
    try {
      this.recognition.stop()
    } catch {
      this.finish()
    }
  }

  /** 会话切换或卸载时取消；不回填已失去所属会话的识别草稿。 */
  cancel(notify = true): void {
    this.release()
    this.text = ''
    this.phase = 'idle'
    if (notify) {
      this.callbacks.onPhase('idle')
      this.callbacks.onPreview('')
    }
  }
}
