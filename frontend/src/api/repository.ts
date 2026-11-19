/**
 * 封装知识库文献接口。
 *
 * JWT 由共享请求实例添加，文件上传使用浏览器生成的 multipart 表单。
 */
import { request } from './request'

/** 知识库中的文献元数据。 */
export interface DocumentItem {
  id: number
  file_name: string
  created_at: string
  updated_at: string
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
export interface DocumentParseResult {
  document_id: number
  file_name: string
  content: string
  character_count: number
  page_count: number | null
  warnings: string[]
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