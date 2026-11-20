/** 封装会话及已保存消息的查询接口。 */
import { request } from './request'
import type { DocumentChatResult } from './chat'

/** 当前用户拥有的一份会话。 */
export interface ChatSession {
  session_id: string
  session_name: string
  user_id: number
  created_at: string
  updated_at: string
}

export interface SessionListResult {
  user_id: number
  total: number
  page: number
  page_size: number
  sessions: ChatSession[]
}

/** 已保存消息必须具有完整的持久化标识。 */
export interface SavedMessage extends DocumentChatResult {
  session_id: string
  message_id: string
  message_no: number
  created_at: string
  updated_at: string
}

export interface MessageListResult {
  session_id: string
  total: number
  page: number
  page_size: number
  messages: SavedMessage[]
}

/** 创建一份属于当前用户的会话。 */
export async function createSession(
  name: string,
  signal?: AbortSignal,
): Promise<ChatSession> {
  const response = await request.post<ChatSession>(
    '/create_session',
    { session_name: name },
    { signal },
  )
  return response.data
}

/** 分页查询当前用户的会话。 */
export async function listSessions(
  page: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<SessionListResult> {
  const response = await request.get<SessionListResult>('/get_sessions', {
    params: { page, page_size: pageSize },
    signal,
  })
  return response.data
}

/** 读取指定会话的历史，不触发模型调用。 */
export async function getMessages(
  sessionId: string,
  page: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<MessageListResult> {
  const response = await request.get<MessageListResult>('/get_messages', {
    params: {
      session_id: sessionId,
      page,
      page_size: pageSize,
    },
    signal,
  })
  return response.data
}