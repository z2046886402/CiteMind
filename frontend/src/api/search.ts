/**
 * 封装文献语义检索接口。
 *
 * 身份令牌由共享 Axios 实例自动携带。
 */
import { request } from './request'

/** 单次检索参数，最低相似度使用原始余弦相似度。 */
export interface SemanticSearchParams {
  question: string
  top_k: number
  min_similarity: number
}

/** 相关片段及其所属文献和位置。 */
export interface SemanticSearchItem {
  document_id: number
  file_name: string
  chunk_index: number
  content: string
  start_char: number
  end_char: number
  score: number
  cosine_similarity: number
}

/** 检索响应，不包含生成式回答。 */
export interface SemanticSearchResult {
  question: string
  model: string
  returned_count: number
  items: SemanticSearchItem[]
  warnings: string[]
}

/**
 * 检索当前用户已建立索引的文献。
 * @param params 问题、结果数量及相似度要求。
 * @param signal 用于离开页面时取消客户端等待。
 */
export async function searchDocuments(
  params: SemanticSearchParams,
  signal?: AbortSignal,
): Promise<SemanticSearchResult> {
  const response = await request.post<SemanticSearchResult>(
    '/search/semantic',
    params,
    {
      signal,
      timeout: 120000,
    },
  )

  return response.data
}