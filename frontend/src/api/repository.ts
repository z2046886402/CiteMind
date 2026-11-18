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