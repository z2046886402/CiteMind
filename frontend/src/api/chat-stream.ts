/** 接收文献问答 SSE；只有 done 事件可以确认完整结果已保存。 */
import { request } from './request'
import { userActions, userState } from '../store/user'
import type { DocumentChatResult } from './chat'
import type { SemanticSearchParams } from './search'

interface StreamHandlers {
  onStatus: (message: string) => void
  onDelta: (content: string) => void
}

/** 拆解完整 SSE 事件；支持当前服务的 LF 和 CRLF 行尾。 */
function parseEvent(block: string) {
  let name = 'message'
  const data: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(':')) continue
    const index = line.indexOf(':')
    const field = index < 0 ? line : line.slice(0, index)
    let value = index < 0 ? '' : line.slice(index + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') name = value
    if (field === 'data') data.push(value)
  }
  if (!data.length) return null
  const value: unknown = JSON.parse(data.join('\n'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('服务器事件格式不正确')
  }
  return { name, data: value as Record<string, unknown> }
}

/**
 * 发起带 Bearer 凭证的 POST 请求，逐段读取并解析 SSE。
 * 网络分包和事件边界互不对应，因此必须缓冲未完成事件。
 * 不自动重试，避免重复生成和保存；超时或中断后应核对历史记录。
 */
export async function askDocumentsStream(
  params: SemanticSearchParams,
  sessionId: string,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<DocumentChatResult> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) controller.abort()
  let timedOut = false
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 240000)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

  try {
    // 复用 Axios 的 URL 配置；fetch 不会执行 Axios 的拦截器。
    const response = await fetch(request.getUri({
      url: '/chat_on_docs/stream',
      params: { session_id: sessionId },
    }), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${userState.token}`,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    })

    if (!response.ok) {
      if (response.status === 401) userActions.logout()
      const body: unknown = await response.json().catch(() => null)
      const detail = body && typeof body === 'object' && 'detail' in body
        ? body.detail : undefined
      throw new Error(typeof detail === 'string'
        ? detail : `问答请求失败（HTTP ${response.status}）`)
    }
    if (!response.headers.get('content-type')?.includes('text/event-stream')
      || !response.body) {
      throw new Error('服务器未返回有效的事件流')
    }

    reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let buffer = ''

    while (true) {
      const chunk = await reader.read()
      // 流式解码会保留跨网络分包的 UTF-8 字节，防止中文乱码。
      buffer += chunk.done ? decoder.decode()
        : decoder.decode(chunk.value, { stream: true })
      let boundary = /\r?\n\r?\n/.exec(buffer)
      while (boundary) {
        const block = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary[0].length)
        const event = parseEvent(block)
        if (event) {
          const { name, data } = event
          if (name === 'status' && typeof data.message === 'string') {
            handlers.onStatus(data.message)
          } else if (name === 'delta' && typeof data.content === 'string') {
            handlers.onDelta(data.content)
          } else if (name === 'error') {
            throw new Error(typeof data.message === 'string'
              ? data.message : '回答处理失败')
          } else if (name === 'done') {
            // 检查成功事件的必要字段；最终正文覆盖临时拼接内容。
            if (data.session_id !== sessionId
              || typeof data.message_id !== 'string'
              || typeof data.question !== 'string'
              || typeof data.answer !== 'string'
              || !['generated', 'no_evidence', 'insufficient_evidence']
                .includes(String(data.status))
              || !Array.isArray(data.references)
              || !Array.isArray(data.used_citation_ids)
              || !Array.isArray(data.warnings)) {
              throw new Error('服务器完成事件缺少必要字段')
            }
            // 兼容旧响应，同时检查新增字段的基本结构。
            if (
              data.recommended_questions !== undefined &&
              (
                !Array.isArray(data.recommended_questions) ||
                data.recommended_questions.length > 3 ||
                data.recommended_questions.some(
                  (question) =>
                    typeof question !== 'string' ||
                    !question.trim(),
                )
              )
            ) {
              throw new Error('服务器推荐追问格式不正确')
            }
            if (
              data.session_name !== undefined &&
              data.session_name !== null &&
              (
                typeof data.session_name !== 'string' ||
                !data.session_name.trim()
              )
            ) {
              throw new Error('服务器会话标题格式不正确')
            }
            return data as unknown as DocumentChatResult
          }
        }
        boundary = /\r?\n\r?\n/.exec(buffer)
      }
      if (buffer.length > 1024 * 1024) {
        throw new Error('服务器事件超过大小限制')
      }
      if (chunk.done) break
    }
    throw new Error('连接已结束，但未收到保存成功通知')
  } catch (error) {
    if (timedOut) throw new Error('回答等待超时，请先核对会话历史')
    throw error
  } finally {
    window.clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    if (reader) {
      try { await reader.cancel() } catch { /* 断开的流可能无法取消。 */ }
      reader.releaseLock()
    }
    controller.abort()
  }
}
