/**
 * 知识库页面：查询当前用户文献，并在上传成功后刷新列表。
 */
import { Alert, Button, Card, Modal, Space, Table, Upload, message } from 'antd'
import type { TableColumnsType, UploadProps } from 'antd'
import axios from 'axios'
import { useCallback, useEffect, useState } from 'react'
import {
  deleteDocument,
  listDocuments,
  uploadDocument,
} from '../../api/repository'
import type { DocumentItem } from '../../api/repository'


const MAX_FILE_SIZE = 20 * 1024 * 1024
const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'txt']

/** 将接口时间转换为本机时间，避免直接显示 ISO 字符串。 */
function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

/** 优先展示后端明确返回的错误说明。 */
function getErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError<{ detail?: unknown }>(error)) {
    const detail = error.response?.data?.detail

    if (typeof detail === 'string') {
      return detail
    }
  }

  return fallback
}

const columns: TableColumnsType<DocumentItem> = [
  {
    title: '文献名称',
    dataIndex: 'file_name',
    ellipsis: true,
  },
  {
    title: '上传时间',
    dataIndex: 'created_at',
    render: (value: string) => formatTime(value),
  },
]

export default function Repository() {
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [listError, setListError] = useState('')
  const [messageApi, contextHolder] = message.useMessage()
  // 页码仅用于计算展示序号，不参与数据库记录标识。
  const [currentPage, setCurrentPage] = useState(1)
  // 保存待确认的记录，确保弹窗与最终删除目标一致。
  const [deleteTarget, setDeleteTarget] = useState<DocumentItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  /**
   * 加载文献列表。
   * 失败时保留已有数据，并单独展示错误，避免误显示为空知识库。
   */
  const loadDocuments = useCallback(async (signal?: AbortSignal) => {
    setListLoading(true)
    setListError('')

    try {
      const result = await listDocuments(signal)

      if (!signal?.aborted) {
        setDocuments(result)
        setCurrentPage(1)
      }
    } catch (error) {
      if (!axios.isCancel(error) && !signal?.aborted) {
        setListError(getErrorMessage(error, '文献列表加载失败，请重试'))
      }
    } finally {
      if (!signal?.aborted) {
        setListLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadDocuments(controller.signal)

    // 离开页面时取消初始请求，避免无用请求继续占用资源。
    return () => controller.abort()
  }, [loadDocuments])

  /** 完成前端校验后上传；后端仍负责最终校验和权限检查。 */
  async function handleUpload(file: File): Promise<void> {
    const extension = file.name.split('.').pop()?.toLowerCase() || ''

    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      messageApi.error('仅支持 PDF、DOCX、TXT 文件')
      return
    }

    if (file.size === 0 || file.size > MAX_FILE_SIZE) {
      messageApi.error('文件不能为空，且大小不能超过 20 MiB')
      return
    }

    setUploading(true)

    try {
      await uploadDocument(file)
      messageApi.success('上传成功')

      // 列表刷新失败由 loadDocuments 单独提示，避免误报上传失败。
      await loadDocuments()
    } catch (error) {
      messageApi.error(getErrorMessage(error, '上传失败，请稍后重试'))
    } finally {
      setUploading(false)
    }
  }

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    void handleUpload(file)

    // 禁止 Upload 自行发送请求，统一使用封装好的 Axios 接口。
    return false
  }

  /** 确认删除后刷新列表；删除失败时保留弹窗，允许重试。 */
  async function handleDelete(): Promise<void> {
    if (!deleteTarget || deleting) {
      return
    }

    setDeleting(true)

    try {
      const result = await deleteDocument(deleteTarget.id)

      if (result.cleanup_completed) {
        messageApi.success(result.message)
      } else {
        messageApi.warning(result.message)
      }

      setDeleteTarget(null)
      await loadDocuments()
    } catch (error) {
      messageApi.error(getErrorMessage(error, '删除失败，请稍后重试'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card
      title="文献知识库"
      extra={
        <Space>
          <Button
            disabled={listLoading || uploading || deleting}
            onClick={() => void loadDocuments()}
          >
            刷新
          </Button>

          <Upload
            accept=".pdf,.docx,.txt"
            multiple={false}
            showUploadList={false}
            disabled={listLoading || uploading}
            beforeUpload={beforeUpload}
          >
            <Button
              type="primary"
              loading={uploading}
              disabled={listLoading || uploading}
            >
              上传文献
            </Button>
          </Upload>
        </Space>
      }
    >
      {contextHolder}

      <p>支持 PDF、DOCX、TXT，单份文件不超过 20 MiB。</p>

      {listError && (
        <Alert
          type="error"
          showIcon
          message={listError}
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<DocumentItem>
        rowKey="id"

        columns={[
          {
            title: '序号',
            key: 'rowNumber',
            width: 90,
            // 跨页连续计数；每页条数与下方分页配置保持一致。
            render: (
              _value: unknown,
              _record: DocumentItem,
              index: number,
            ) => (currentPage - 1) * 10 + index + 1,
          },
          ...columns,
          {
            title: '操作',
            key: 'actions',
            width: 100,
            render: (_value: unknown, record: DocumentItem) => (
              <Button
                danger
                type="link"
                disabled={listLoading || uploading || deleting}
                onClick={() => setDeleteTarget(record)}
              >
                删除
              </Button>
            ),
          },
        ]}

        dataSource={documents}
        loading={listLoading}
        locale={{
          emptyText: listError ? '列表暂不可用，请刷新重试' : '暂无文献',
        }}
        pagination={{
          current: currentPage,
          pageSize: 10,
          hideOnSinglePage: true,
          showSizeChanger: false,
          onChange: (page) => setCurrentPage(page),
        }}
      />
      <Modal
        title="确认删除文献"
        open={deleteTarget !== null}
        okText="确认删除"
        cancelText="取消"
        confirmLoading={deleting}
        okButtonProps={{ danger: true }}
        cancelButtonProps={{ disabled: deleting }}
        closable={!deleting}
        keyboard={!deleting}
        maskClosable={false}
        onOk={() => void handleDelete()}
        onCancel={() => {
          if (!deleting) {
            setDeleteTarget(null)
          }
        }}
      >
        <p>
          确定删除“{deleteTarget?.file_name}”吗？确认后将删除文献记录和原文件。
        </p>
      </Modal>
    </Card>
  )
}