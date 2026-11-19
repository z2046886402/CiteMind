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
}

/**
 * 根据当前用户的文献生成单轮回答。
 * @param params 问题及检索参数。
 * @param signal 用于离开页面时取消客户端等待。
 */
export async function askDocuments(
  params: SemanticSearchParams,
  signal?: AbortSignal,
): Promise<DocumentChatResult> {
  const response = await request.post<DocumentChatResult>(
    '/chat_on_docs',
    params,
    {
      signal,
      // 非流式请求包含检索和回答模型调用，单独设置等待时间。
      timeout: 240000,
    },
  )

  return response.data
}