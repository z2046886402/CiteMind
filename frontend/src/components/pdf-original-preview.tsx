/**
 * 通过受保护接口获取 PDF，并使用浏览器内置阅读器预览。
 *
 * 组件卸载时取消请求、释放文件地址，避免长期占用内存。
 * 页码来自来源分块，不表示已经定位到具体句子。
 */
import { Alert, Select, Space, Spin } from 'antd'
import axios from 'axios'
import { useEffect, useState } from 'react'
import { getDocumentPdf } from '../api/repository'

interface PdfOriginalPreviewProps {
  documentId: number
  fileName: string
  pageNumbers?: number[]
}

/** 文件接口返回二进制响应，按 HTTP 状态提供稳定的错误提示。 */
function previewError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    switch (error.response?.status) {
      case 401:
        return '登录已失效，请重新登录'
      case 404:
        return '文献不存在或原文件已不可用'
      case 400:
        return '该文件当前无法按 PDF 预览，请检查原文件'
    }
  }

  return 'PDF 加载失败，请检查网络或稍后重新打开'
}

export default function PdfOriginalPreview({
  documentId,
  fileName,
  pageNumbers,
}: PdfOriginalPreviewProps) {
  const pages = Array.from(
    new Set(pageNumbers ?? []),
  )
    .filter(
      (value) => Number.isInteger(value) && value > 0,
    )
    .sort((a, b) => a - b)

  const initialPage = pages[0] ?? 1

  const [page, setPage] = useState(initialPage)
  const [fileUrl, setFileUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    let createdUrl = ''

    setLoading(true)
    setError('')
    setFileUrl('')
    setPage(initialPage)

    async function load(): Promise<void> {
      try {
        const blob = await getDocumentPdf(
          documentId,
          controller.signal,
        )

        // 请求结束时窗口可能已经关闭，不再创建文件地址。
        if (!active) {
          return
        }

        createdUrl = URL.createObjectURL(blob)
        setFileUrl(createdUrl)
      } catch (error) {
        if (active && !axios.isCancel(error)) {
          setError(previewError(error))
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      active = false
      controller.abort()

      if (createdUrl) {
        URL.revokeObjectURL(createdUrl)
      }
    }
  }, [documentId, initialPage])

  if (loading) {
    return (
      <Spin tip="正在加载 PDF 原文">
        <div style={{ height: 180 }} />
      </Spin>
    )
  }

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message={error}
      />
    )
  }

  return (
    <Space
      direction="vertical"
      size="middle"
      style={{ width: '100%' }}
    >
      <Alert
        type="info"
        showIcon
        message={
          pages.length
            ? '按来源分块页码查看原文，可切换到其他来源页。'
            : '当前引用没有提供页码，默认从第 1 页打开。'
        }
      />

      <Space wrap>
        {pages.length > 0 && (
          <>
            <span>来源页：</span>

            <Select
              value={page}
              onChange={(value) => setPage(value)}
              style={{ width: 160 }}
              options={pages.map((value) => ({
                value,
                label: `第 ${value} 页`,
              }))}
            />
          </>
        )}

        <a href={fileUrl} download={fileName}>
          下载 PDF 原文件
        </a>
      </Space>

      <iframe
        key={page}
        title={`${fileName} PDF 原文`}
        src={`${fileUrl}#page=${page}&view=FitH`}
        style={{
          width: '100%',
          height: '65vh',
          border: '1px solid #f0f0f0',
        }}
      />

      <small>
        如果浏览器无法显示内嵌 PDF，可下载原文件核对。
      </small>
    </Space>
  )
}