/**
 * 封装知识库文献接口。
 *
 * JWT 由共享请求实例添加，文件上传使用浏览器生成的 multipart 表单。
 */
import { request } from './request'

/** 最近一次索引任务状态，与后端枚举保持一致。 */
export type DocumentIndexStatus =
  | 'unknown'
  | 'not_indexed'
  | 'indexing'
  | 'indexed'
  | 'failed'

/** 知识库中的文献元数据。 */
/** 知识库文献元数据及已持久化的索引任务信息。 */
export interface DocumentItem {
  id: number
  file_name: string
  created_at: string
  updated_at: string

  index_status: DocumentIndexStatus
  index_started_at: string | null
  index_finished_at: string | null
  index_error: string | null

  /** 最近一次成功记录，重建失败时仍可能有值。 */
  indexed_at: string | null
  indexed_chunks: number | null
}

/** 单份文献上传成功后的响应。 */
interface UploadResponse {
  status: string
  message: string
  data: {
    file_id: string
    file_name: string
    file_size: number
  }
}

/**
 * 查询当前用户的文献列表。
 * @param signal 用于页面卸载时取消尚未完成的请求。
 */
export async function listDocuments(signal?: AbortSignal) {
  const response = await request.get<DocumentItem[]>('/get_files', {
    signal,
  })

  return response.data
}

/**
 * 上传一份文献。
 * @param file 用户选择的本机文件。
 */
export async function uploadDocument(file: File) {
  const form = new FormData()
  form.append('files', file)

  // 不手动设置 Content-Type，由浏览器补齐 multipart boundary。
  const response = await request.post<UploadResponse>(
    '/upload_files',
    form,
    { timeout: 60000 },
  )

  return response.data
}

/** 删除接口的结果，包括原文件是否已完成清理。 */
interface DeleteResponse {
  status: string
  message: string
  cleanup_completed: boolean
}

/**
 * 删除当前用户的一份文献。
 * @param documentId 数据库中的真实编号，不是表格展示序号。
 */
export async function deleteDocument(documentId: number) {
  const response = await request.delete<DeleteResponse>(
    `/delete_file/${documentId}`,
  )

  return response.data
}

/** 后端文本提取结果；page_count 仅对 PDF 有意义。 */
/** PDF 页面尺寸，单位为 PDF point。 */
export interface ParsedPage {
  page_number: number
  width: number
  height: number
}

/** 页面左上角为原点的区域坐标。 */
export interface BlockBoundingBox {
  x0: number
  top: number
  x1: number
  bottom: number
}

/** 文本块的页面位置；没有可靠坐标时 bbox 为 null。 */
export interface BlockPosition {
  page_number: number
  bbox: BlockBoundingBox | null
}

/** 解析阶段的文本块，与后续 Token 分块属于不同层次。 */
export interface ParsedBlock {
  block_index: number
  kind: 'heading' | 'paragraph' | 'table'
  text: string

  /** 后端按 Unicode 字符计数的左闭右开范围。 */
  start_char: number
  end_char: number

  positions: BlockPosition[]
  table_rows: (string | null)[][] | null
  table_html: string | null
}

/** 文献全文及统一解析结构。 */
export interface DocumentParseResult {
  document_id: number
  file_name: string
  content: string
  character_count: number
  page_count: number | null
  warnings: string[]

  parser_name: string | null
  pages: ParsedPage[]
  blocks: ParsedBlock[]
}

/**
 * 请求解析一份已上传文献。
 * @param documentId 数据库中的真实文献编号。
 * @param signal 用于关闭预览时取消客户端等待。
 */
export async function parseDocument(
  documentId: number,
  signal?: AbortSignal,
): Promise<DocumentParseResult> {
  const response = await request.post<DocumentParseResult>(
    `/documents/${documentId}/parse`,
    undefined,
    {
      signal,
      timeout: 120000,
    },
  )

  return response.data
}

/** 生成分块时使用的参数，单位为 Token。 */
export interface DocumentChunkOptions {
  chunk_size: number
  chunk_overlap: number
}

/** 单个分块及其在解析后全文中的位置。 */
export interface DocumentChunkItem {
  chunk_index: number
  content: string
  character_count: number
  token_count: number
  start_char: number
  end_char: number
  start_token: number
  end_token: number
}

/** 后端返回的完整分块结果。 */
export interface DocumentChunkResult {
  document_id: number
  file_name: string
  tokenizer: string
  chunk_size: number
  chunk_overlap: number
  total_chunks: number
  chunks: DocumentChunkItem[]
  warnings: string[]
}

/**
 * 根据指定参数生成文献分块。
 * @param documentId 数据库中的真实文献编号。
 * @param options 分块大小和目标重叠数量。
 * @param signal 用于关闭弹窗时取消客户端等待。
 */
export async function generateDocumentChunks(
  documentId: number,
  options: DocumentChunkOptions,
  signal?: AbortSignal,
): Promise<DocumentChunkResult> {
  const response = await request.post<DocumentChunkResult>(
    `/documents/${documentId}/chunks`,
    options,
    {
      signal,
      timeout: 120000,
    },
  )

  return response.data
}

/** 一次文献索引请求成功后的结果。 */
export interface DocumentIndexResult {
  document_id: number
  file_name: string
  index_name: string
  model: string
  dimensions: number
  indexed_chunks: number
  removed_old_chunks: number
  warnings: string[]
}

/**
 * 为当前用户的文献建立搜索索引。
 *
 * @param documentId 数据库中的真实文献编号。
 * @param options 分块大小和重叠数量，单位为 Token。
 * @param signal 取消浏览器等待的信号，不保证后端立即停止。
 * @returns 本次写入、旧分块清理数量及处理提示。
 */
export async function buildDocumentIndex(
  documentId: number,
  options: DocumentChunkOptions,
  signal?: AbortSignal,
): Promise<DocumentIndexResult> {
  const response = await request.post<DocumentIndexResult>(
    `/documents/${documentId}/index`,
    options,
    {
      signal,
      // 整篇文献需要多次向量请求，允许等待五分钟。
      timeout: 300000,
    },
  )

  return response.data
}