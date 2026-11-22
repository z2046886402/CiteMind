/**
 * 封装文献混合检索接口。
 *
 * 使用正文关键词和向量共同检索。
 * 身份令牌由共享 Axios 实例自动携带。
 */
import { request } from './request'

/** 用户可以选择的重排方式，与后端枚举保持一致。 */
export type RerankMethod = 'rule' | 'model'

/** 单次检索参数，最低相似度使用原始余弦相似度。 */
export interface SemanticSearchParams {
  question: string
  top_k: number
  min_similarity: number
  /** 不传时由后端默认使用规则重排，兼容已有调用。 */
  rerank_method?: RerankMethod
}

/** 相关片段及其所属文献和位置。 */
export interface SemanticSearchItem {
  document_id: number
  file_name: string
  chunk_index: number
  content: string
  start_char: number
  end_char: number
  /** 关键词与向量融合后的排序分数，不表示概率或正确率。 */
  score: number

  /** 单独计算的余弦相似度，与混合排序分数含义不同。 */
  cosine_similarity: number
  /** 旧结果和历史引用可能没有重排字段。 */
  rerank_method?: RerankMethod | null

  /** 最终排序分数，不表示回答正确率。 */
  rerank_score?: number | null
  /** 整个来源分块涉及的真实页码；旧数据可能没有。 */
  page_numbers?: number[]

  /** null 或缺失表示尚未提供表格信息。 */
  contains_table?: boolean | null
}

/** 检索响应，不包含生成式回答。 */
export interface SemanticSearchResult {
  question: string
  model: string
  returned_count: number
  items: SemanticSearchItem[]
  warnings: string[]
  /** 整个来源分块涉及的真实页码；旧数据可能没有。 */
  page_numbers?: number[]

  /** null 或缺失表示尚未提供表格信息。 */
  contains_table?: boolean | null
}

/**
 * 混合检索当前用户已建立索引的文献。
 *
 * @param params 问题、最多返回条数和最终结果的最低余弦相似度。
 * @param signal 取消客户端等待的信号。
 * @returns 按所选重排方式排序的片段，保留原始混合召回分数。
 */
/** 用户可以选择的重排方式，与后端枚举保持一致。 */

export async function searchDocuments(
  params: SemanticSearchParams,
  signal?: AbortSignal,
): Promise<SemanticSearchResult> {
  const response = await request.post<SemanticSearchResult>(
    '/search/hybrid',
    params,
    {
      signal,
      timeout: 120000,
    },
  )

  return response.data
}