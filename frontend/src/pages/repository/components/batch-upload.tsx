/**
 * 批量上传入口：逐份校验、顺序提交并保留各文件的结果。
 * 本组件负责上传，索引建立仍由知识库现有流程处理。
 */
import { Button, Modal, Table, Tag } from 'antd'
import type { TableColumnsType } from 'antd'
import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import { uploadDocument } from '../../../api/repository'

type UploadStatus =
  | 'waiting'
  | 'uploading'
  | 'success'
  | 'rejected'
  | 'failed'
  | 'unknown'

interface UploadItem {
  key: string
  fileName: string
  status: UploadStatus
  detail: string
}

interface BatchUploadProps {
  disabled: boolean
  onBusyChange: (busy: boolean) => void
  onFinished: () => Promise<void>
}

const MAX_FILE_SIZE = 20 * 1024 * 1024
const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'txt']

const STATUS_META: Record<
  UploadStatus,
  { color: string; label: string }
> = {
  waiting: { color: 'default', label: '等待上传' },
  uploading: { color: 'processing', label: '正在上传' },
  success: { color: 'success', label: '上传成功' },
  rejected: { color: 'warning', label: '校验未通过' },
  failed: { color: 'error', label: '上传失败' },
  unknown: { color: 'warning', label: '结果待确认' },
}

const columns: TableColumnsType<UploadItem> = [
  {
    title: '文献名称',
    dataIndex: 'fileName',
    ellipsis: true,
  },
  {
    title: '状态',
    dataIndex: 'status',
    width: 130,
    render: (status: UploadStatus) => (
      <Tag color={STATUS_META[status].color}>
        {STATUS_META[status].label}
      </Tag>
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
    status: UploadStatus,
    detail: string,
  ): void {
    setItems((current) =>
      current.map((item) =>
        item.key === key ? { ...item, status, detail } : item,
      ),
    )
  }

  /**
   * 同一时间只运行一个上传队列，单份失败继续处理下一份。
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

        updateItem(item.key, 'uploading', '正在提交文件')

        try {
          await uploadDocument(files[index], controller.signal)

          if (controller.signal.aborted) return

          updateItem(
            item.key,
            'success',
            '已上传，可在列表中建立索引',
          )
        } catch (error: unknown) {
          if (controller.signal.aborted) return

          // 超时、断网或服务端异常可能发生在保存之后，
          // 因此不自动重试，也不直接断言文件未上传。
          if (
            !axios.isAxiosError(error) ||
            !error.response ||
            error.response.status >= 500
          ) {
            updateItem(
              item.key,
              'unknown',
              '请刷新文献列表核对，再决定是否重新上传',
            )
          } else {
            const detail: unknown = error.response.data?.detail

            updateItem(
              item.key,
              'failed',
              typeof detail === 'string'
                ? detail
                : '请求未成功，请检查后重试',
            )
          }
        }
      }

      // 整批结束后只刷新一次列表，避免逐份上传时重复查询。
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
        title="批量上传结果"
        open={open}
        width={820}
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
          共 {items.length} 份，
          成功 {items.filter((item) => item.status === 'success').length} 份
          {busy ? '，正在依次上传…' : '，本批已结束。'}
        </p>

        <Table<UploadItem>
          rowKey="key"
          size="small"
          dataSource={items}
          columns={columns}
          pagination={false}
          scroll={{ x: 650, y: 360 }}
        />

        <p style={{ color: '#8c8c8c', fontSize: 12 }}>
          结果待确认的文件请先核对文献列表，避免重复上传。
        </p>
      </Modal>
    </>
  )
}