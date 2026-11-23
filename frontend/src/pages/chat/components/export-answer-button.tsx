/**
 * 为当前完整回答和历史消息提供统一的导出入口。
 *
 * 下载操作使用调用时的问答快照，不请求后端。
 */
import { Button, message } from 'antd'
import type { DocumentChatResult } from '../../../api/chat'
import { downloadAnswerMarkdown } from '../../../utils/answer-export'

interface ExportAnswerButtonProps {
  result: DocumentChatResult
}

export default function ExportAnswerButton({
  result,
}: ExportAnswerButtonProps) {
  const [messageApi, contextHolder] = message.useMessage()

  /** 发起下载；浏览器是否最终保存由下载设置决定。 */
  function handleExport(): void {
    try {
      downloadAnswerMarkdown(result)
    } catch {
      void messageApi.error(
        '未能发起导出，请稍后重试',
      )
    }
  }

  return (
    <>
      {contextHolder}

      <Button
        size="small"
        onClick={handleExport}
      >
        导出 Markdown
      </Button>
    </>
  )
}