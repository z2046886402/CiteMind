/** 封装非流式文献问答接口。 */
import { request } from './request'
import type {
  SemanticSearchItem,
  SemanticSearchParams,
} from './search'

/** 本次回答中的引用来源，编号仅在本次回答中有效。 */
export interface AnswerReference extends SemanticSearchItem {
  citation_id: number
}

/** 后端问答响应；generated 不代表事实已经自动核验。 */
export interface DocumentChatResult {
  status: 'generated' | 'no_evidence' | 'insufficient_evidence'
  question: string
  answer: string
  model: string | null
  references: AnswerReference[]
  used_citation_ids: number[]
  warnings: string[]
  session_id: string | null
  message_id: string | null
  message_no: number | null
  created_at: string | null
}

/**
 * 生成文献回答；指定会话时由后端保存问答。
 * @param params 问题及检索参数。
 * @param signal 取消客户端等待的信号。
 * @param sessionId 需要保存问答的会话编号。
 */
export async function askDocuments(
  params: SemanticSearchParams,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<DocumentChatResult> {
  const response = await request.post<DocumentChatResult>(
    '/chat_on_docs',
    params,
    {
      params: sessionId ? { session_id: sessionId } : undefined,
      signal,
      timeout: 240000,
    },
  )

  return response.data
}