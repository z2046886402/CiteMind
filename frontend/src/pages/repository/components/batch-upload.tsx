/**
 * 文献导入入口：逐份上传，并自动调用已有索引流程完成解析、分块和向量写入。
 * 上传结果与处理结果分别保留，避免索引异常被误认为上传失败。
 */
import { Button, Modal, Table, Tag } from 'antd'
import type { TableColumnsType } from 'antd'
import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import { buildDocumentIndex, uploadDocument } from '../../../api/repository'

type UploadStatus =
  'waiting' | 'uploading' | 'success' | 'rejected' | 'failed' | 'unknown'

type ProcessingStatus = 'not_started' | 'processing' | 'completed' | 'failed' | 'unknown'

interface UploadItem {
  key: string
  fileName: string
  status: UploadStatus
  processingStatus: ProcessingStatus
  detail: string
}

interface BatchUploadProps {
  disabled: boolean
  onBusyChange: (busy: boolean) => void
  onFinished: () => Promise<void>
}

const MAX_FILE_SIZE = 20 * 1024 * 1024
const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'txt']

const STATUS_META: Record<UploadStatus, { color: string; label: string }> = {
  waiting: { color: 'default', label: '等待上传' },
  uploading: { color: 'processing', label: '正在上传' },
  success: { color: 'success', label: '上传成功' },
  rejected: { color: 'warning', label: '校验未通过' },
  failed: { color: 'error', label: '上传失败' },
  unknown: { color: 'warning', label: '结果待确认' },
}

/** 与手动建立索引使用相同的分块参数，确保两种入口结果一致。 */
const INDEX_OPTIONS = { chunk_size: 512, chunk_overlap: 64 }

const PROCESSING_META: Record<ProcessingStatus, { color: string; label: string }> = {
  not_started: { color: 'default', label: '未开始' },
  processing: { color: 'processing', label: '正在处理' },
  completed: { color: 'success', label: '处理完成' },
  failed: { color: 'error', label: '处理失败' },
  unknown: { color: 'warning', label: '结果待确认' },
}

/** 网络或服务端异常可能发生在写入之后，不能据此自动重试。 */
function isUncertain(error: unknown): boolean {
  return !axios.isAxiosError(error) || !error.response || error.response.status >= 500
}

/** 提取后端明确返回的错误描述，不直接展示异常对象。 */
function errorDescription(error: unknown, fallback: string): string {
  if (axios.isAxiosError<{ detail?: unknown }>(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === 'string') return detail
  }
  return fallback
}

const columns: TableColumnsType<UploadItem> = [
  {
    title: '文献名称',
    dataIndex: 'fileName',
    ellipsis: true,
  },
  {
    title: '上传状态',
    dataIndex: 'status',
    width: 130,
    render: (status: UploadStatus) => (
      <Tag color={STATUS_META[status].color}>{STATUS_META[status].label}</Tag>
    ),
  },
  {
    title: '处理状态',
    dataIndex: 'processingStatus',
    width: 130,
    render: (status: ProcessingStatus) => (
      <Tag color={PROCESSING_META[status].color}>{PROCESSING_META[status].label}</Tag>
    ),
  },
  {
    title: '说明',
    dataIndex: 'detail',
    width: 300,
  },
]

/** 前端校验用于及时反馈，后端仍负责文件和权限的最终校验。 */
function validateFile(file: File): string {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''

  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return '仅支持 PDF、DOCX、TXT 文件'
  }

  if (file.size === 0) {
    return '文件不能为空'
  }

  if (file.size > MAX_FILE_SIZE) {
    return '单份文件不能超过 20 MiB'
  }

  return ''
}

export default function BatchUpload({
  disabled,
  onBusyChange,
  onFinished,
}: BatchUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const [items, setItems] = useState<UploadItem[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return () => controllerRef.current?.abort()
  }, [])

  /** 使用队列键更新单项，同名文件也分别展示。 */
  function updateItem(
    key: string,
    patch: Partial<Pick<UploadItem, 'status' | 'processingStatus' | 'detail'>>,
  ): void {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    )
  }

  /**
   * 同一时间只运行一个导入队列，每份上传后等待处理结束再继续下一份。
   * 上传或处理失败仅影响当前文件；上传已确认的文件不会自动重复上传。
   * 页面卸载时取消客户端等待，并停止提交后续文件。
   */
  async function handleFiles(files: File[]): Promise<void> {
    if (disabled || controllerRef.current || files.length === 0) {
      return
    }

    const queue: UploadItem[] = files.map((file, index) => {
      const error = validateFile(file)

      return {
        key: String(index),
        fileName: file.name,
        status: error ? 'rejected' : 'waiting',
        processingStatus: 'not_started',
        detail: error || '等待上传',
      }
    })

    setItems(queue)
    setOpen(true)

    if (queue.every((item) => item.status === 'rejected')) {
      return
    }

    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    onBusyChange(true)

    try {
      for (const [index, item] of queue.entries()) {
        if (controller.signal.aborted) return
        if (item.status === 'rejected') continue

        updateItem(item.key, { status: 'uploading', detail: '正在提交文件' })

        let documentId: number
        try {
          const uploaded = await uploadDocument(files[index], controller.signal)
          if (controller.signal.aborted) return

          // 后端 file_id 是数据库记录编号；禁止用文件名或展示序号匹配索引目标。
          updateItem(item.key, { status: 'success', detail: '上传成功，准备处理' })
          documentId = Number(uploaded.data?.file_id)
          if (!Number.isSafeInteger(documentId) || documentId <= 0) {
            updateItem(item.key, {
              processingStatus: 'failed',
              detail: '已上传，但返回的文献编号无效，请刷新列表后手动建立索引',
            })
            continue
          }
        } catch (error: unknown) {
          if (controller.signal.aborted) return
          updateItem(item.key, {
            status: isUncertain(error) ? 'unknown' : 'failed',
            detail: isUncertain(error)
              ? '上传结果待确认，请刷新文献列表核对，避免重复上传'
              : errorDescription(error, '上传请求未成功，请检查后重试'),
          })
          continue
        }

        updateItem(item.key, {
          processingStatus: 'processing',
          detail: '正在解析、分块、生成向量并建立索引',
        })
        try {
          const indexed = await buildDocumentIndex(
            documentId,
            INDEX_OPTIONS,
            controller.signal,
          )
          if (controller.signal.aborted) return
          updateItem(item.key, {
            processingStatus: 'completed',
            detail:
              `已建立 ${indexed.indexed_chunks} 个分块，可进行检索和问答` +
              (indexed.warnings.length
                ? `；处理提示：${indexed.warnings.join('；')}`
                : ''),
          })
        } catch (error: unknown) {
          if (controller.signal.aborted) return
          updateItem(item.key, {
            processingStatus: isUncertain(error) ? 'unknown' : 'failed',
            detail:
              '文件已上传。' +
              errorDescription(error, '自动处理未完成') +
              '；请先核对列表中的索引状态，必要时使用“建立索引”，无需重新上传',
          })
        }
      }

      // 整批结束后刷新持久化状态；列表读取失败不改变各文件的上传和处理结果。
      if (!controller.signal.aborted) {
        await onFinished()
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null

        if (!controller.signal.aborted) {
          setBusy(false)
          onBusyChange(false)
        }
      }
    }
  }

  return (
    <>
      <Button
        type="primary"
        loading={busy}
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        批量上传
      </Button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.txt"
        hidden
        disabled={disabled || busy}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])

          // 清空控件，允许下次重新选择同一个文件。
          event.currentTarget.value = ''
          void handleFiles(files)
        }}
      />

      <Modal
        title="文献上传与自动处理"
        open={open}
        width={1020}
        closable={!busy}
        maskClosable={!busy}
        keyboard={!busy}
        onCancel={() => setOpen(false)}
        footer={
          <Button disabled={busy} onClick={() => setOpen(false)}>
            关闭
          </Button>
        }
      >
        <p>
          共 {items.length} 份， 上传成功{' '}
          {items.filter((item) => item.status === 'success').length} 份 ，处理完成{' '}
          {items.filter((item) => item.processingStatus === 'completed').length} 份
          {busy ? '，正在依次上传并处理…' : '，本批已结束。'}
        </p>

        <Table<UploadItem>
          rowKey="key"
          size="small"
          dataSource={items}
          columns={columns}
          pagination={false}
          scroll={{ x: 900, y: 360 }}
        />

        <p style={{ color: '#8c8c8c', fontSize: 12 }}>
          处理期间请保持当前页面打开。上传成功但处理失败的文件无需重传；结果待确认时，请先核对列表中的索引状态。
        </p>
      </Modal>
    </>
  )
}
