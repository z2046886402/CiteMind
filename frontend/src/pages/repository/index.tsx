/**
 * 知识库页面：查询当前用户文献，并在上传成功后刷新列表。
 */
import DocumentPreview from './components/document-preview'
import {
  Alert,
  Button,
  Card,
  Modal,
  Space,
  Table,
  Tag,
  Tooltip,
  message,
} from 'antd'
import type { TableColumnsType } from 'antd'
import axios from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildDocumentIndex,
  deleteDocument,
  listDocuments,
} from '../../api/repository'
import type {
  DocumentItem,
  DocumentIndexResult,
  DocumentIndexStatus,
} from '../../api/repository'
import ChunkPreview from './components/chunk-preview'
import BatchUpload from './components/batch-upload'

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

/** 将后端任务状态转换为页面标签，集中维护颜色和文案。 */
const INDEX_STATUS_META: Record<
  DocumentIndexStatus,
  { color: string; label: string }
> = {
  unknown: { color: 'default', label: '待确认' },
  not_indexed: { color: 'default', label: '未建立' },
  indexing: { color: 'processing', label: '处理中' },
  indexed: { color: 'success', label: '已完成' },
  failed: { color: 'error', label: '失败' },
}

const columns: TableColumnsType<DocumentItem> = [
  {
    title: '文献名称',
    dataIndex: 'file_name',
    width: 280,
    ellipsis: true,
  },
  {
    title: '上传时间',
    dataIndex: 'created_at',
    width: 200,
    render: (value: string) => formatTime(value),
  },
  {
    title: '最近索引任务',
    dataIndex: 'index_status',
    width: 140,
    render: (
      value: DocumentIndexStatus,
      record: DocumentItem,
    ) => {
      const metadata =
        INDEX_STATUS_META[value] ?? INDEX_STATUS_META.unknown

      return (
        <Tooltip title={record.index_error || undefined}>
          <Tag color={metadata.color}>
            {metadata.label}
          </Tag>
        </Tooltip>
      )
    },
  },
  {
    title: '最近成功分块数',
    dataIndex: 'indexed_chunks',
    width: 150,
    // 0 是有效数量，只有 null 或 undefined 才显示占位符。
    render: (value: number | null) => value ?? '—',
  },
  {
    title: '最近成功时间',
    dataIndex: 'indexed_at',
    width: 200,
    render: (value: string | null) =>
      value ? formatTime(value) : '—',
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
  // 分块预览目标与全文预览目标分开管理。
  const [chunkTarget, setChunkTarget] = useState<DocumentItem | null>(null)

  /**
   * 加载文献列表。
   * 失败时保留已有数据，并单独展示错误，避免误显示为空知识库。
   */
  const loadDocuments = useCallback(async (
    signal?: AbortSignal,
    resetPage = true,
  ) => {
    setListLoading(true)
    setListError('')

    try {
      const result = await listDocuments(signal)

      if (!signal?.aborted) {
        setDocuments(result)

        if (resetPage) {
          setCurrentPage(1)
        }
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

  // 保存预览目标，使用真实记录 ID 区分不同文献。
  const [previewTarget, setPreviewTarget] = useState<DocumentItem | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void loadDocuments(controller.signal)

    // 离开页面时取消初始请求，避免无用请求继续占用资源。
    return () => controller.abort()
  }, [loadDocuments])

  /** 完成前端校验后上传；后端仍负责最终校验和权限检查。 */


  /** 确认删除后刷新列表；删除失败时保留弹窗，允许重试。 */
  async function handleDelete(): Promise<void> {
    if (!deleteTarget || deleting || indexControllerRef.current) {
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


  /** 当前正在建立索引的文献，同一页面一次处理一份。 */
  const [indexingId, setIndexingId] = useState<number | null>(null)

  /** 最近一次成功请求的结果，不代表持久化的索引状态。 */
  const [indexResult, setIndexResult] =
    useState<DocumentIndexResult | null>(null)

  const [indexError, setIndexError] = useState('')

  // 同步记录请求占用，避免连续点击时在状态更新前重复发送请求。
  const indexControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => indexControllerRef.current?.abort()
  }, [])

  /**
   * 为选中文献建立索引，并分别管理等待、成功和未确认状态。
   *
   * 请求失败或超时可能发生在部分写入之后，因此不自动重试。
   * 页面卸载后取消浏览器等待，避免继续更新已卸载组件。
   */
  async function handleBuildIndex(
    document: DocumentItem,
  ): Promise<void> {
    if (
      listLoading ||
      uploading ||
      deleting ||
      indexControllerRef.current
    ) {
      return
    }

    const controller = new AbortController()
    indexControllerRef.current = controller

    setIndexingId(document.id)
    setIndexResult(null)
    setIndexError('')

    try {
      const result = await buildDocumentIndex(
        document.id,
        {
          // 本步先使用固定分块参数。
          chunk_size: 512,
          chunk_overlap: 64,
        },
        controller.signal,
      )

      if (!controller.signal.aborted) {
        setIndexResult(result)
      }
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        return
      }

      setIndexError(
        getErrorMessage(error, '索引请求失败或等待超时'),
      )
    } finally {
      try {
        if (!controller.signal.aborted) {
          // 成功或失败后都重新读取持久化状态，并保留当前页。
          // 列表读取失败由 loadDocuments 单独提示。
          await loadDocuments(controller.signal, false)
        }
      } finally {
        // 即使刷新过程中发生异常，也要解除当前请求占用。
        if (indexControllerRef.current === controller) {
          indexControllerRef.current = null

          if (!controller.signal.aborted) {
            setIndexingId(null)
          }
        }
      }
    }
  }
  return (
    <Card
      title="文献知识库"
      extra={
        <Space>
          <Button
            disabled={
              listLoading || uploading || deleting || indexingId !== null
            }
            onClick={() => void loadDocuments()}
          >
            刷新
          </Button>

          <BatchUpload
            disabled={
              listLoading || uploading || deleting || indexingId !== null
            }
            onBusyChange={setUploading}
            onFinished={() => loadDocuments()}
          />
        </Space>
      }
    >
      {contextHolder}

      <p>支持 PDF、DOCX、TXT，单份文件不超过 20 MiB。</p>
      <p>
        上传后请建立索引，再进行检索和问答；重复建立索引会重新调用向量服务。
      </p>
      <p>
        状态表示最近一次索引任务结果；失败时可悬停查看错误摘要，
        最近成功记录会独立保留。
      </p>

      {listError && (
        <Alert
          type="error"
          showIcon
          message={listError}
          style={{ marginBottom: 16 }}
        />
      )}
      {indexingId !== null && (
        <Alert
          type="info"
          showIcon
          message="正在建立索引"
          description="正在进行文献解析、分块、向量生成和索引写入，请稍候。"
          style={{ marginBottom: 16 }}
        />
      )}

      {indexError && (
        <Alert
          type="error"
          showIcon
          message="本次索引结果未确认"
          description={
            `${indexError}。失败或超时可能已写入部分分块，` +
            '请核对后再决定是否重新执行。'
          }
          style={{ marginBottom: 16 }}
        />
      )}

      {indexResult && (
        <>
          <Alert
            type="success"
            showIcon
            message="最近一次索引请求已完成"
            description={
              `${indexResult.file_name}：` +
              `写入 ${indexResult.indexed_chunks} 个分块，` +
              `清理 ${indexResult.removed_old_chunks} 个旧分块。`
            }
            style={{ marginBottom: 16 }}
          />

          {indexResult.warnings.map((warning, index) => (
            <Alert
              key={`${index}-${warning}`}
              type="warning"
              showIcon
              message={warning}
              style={{ marginBottom: 16 }}
            />
          ))}
        </>
      )}
      <Table<DocumentItem>
        rowKey="id"
        scroll={{ x: 1500 }}
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
            title: '搜索索引',
            key: 'buildIndex',
            width: 140,
            render: (_value: unknown, record: DocumentItem) => (
              <Button
                type="link"
                loading={indexingId === record.id}
                disabled={
                  listLoading ||
                  uploading ||
                  deleting ||
                  indexingId !== null
                }
                onClick={() => void handleBuildIndex(record)}
              >
                建立索引
              </Button>
            ),
          },
          {
            title: '操作',
            key: 'actions',
            width: 280,
            render: (_value: unknown, record: DocumentItem) => (
              <Space size="small">
                <Button
                  type="link"
                  disabled={
                    listLoading || uploading || deleting || indexingId !== null
                  }
                  onClick={() => setPreviewTarget(record)}
                >
                  解析预览
                </Button>

                <Button
                  type="link"
                  disabled={
                    listLoading || uploading || deleting || indexingId !== null
                  }
                  onClick={() => setChunkTarget(record)}
                >
                  分块预览
                </Button>

                <Button
                  danger
                  type="link"
                  disabled={
                    listLoading || uploading || deleting || indexingId !== null
                  }
                  onClick={() => setDeleteTarget(record)}
                >
                  删除
                </Button>
              </Space>
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
      {previewTarget && (
        <DocumentPreview
          key={previewTarget.id}
          document={previewTarget}
          onClose={() => setPreviewTarget(null)}
        />
      )}
      {chunkTarget && (
        <ChunkPreview
          key={chunkTarget.id}
          document={chunkTarget}
          onClose={() => setChunkTarget(null)}
        />
      )}
    </Card>
  )
}