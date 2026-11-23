/**
 * 展示已经随回答保存的推荐追问。
 *
 * 本组件只负责展示和通知父页面，不自行发送问答请求。
 */
import { Button, Space } from 'antd'

interface RecommendedQuestionsProps {
  questions?: string[]
  disabled: boolean
  onAsk: (question: string) => void
}

export default function RecommendedQuestions({
  questions = [],
  disabled,
  onAsk,
}: RecommendedQuestionsProps) {
  if (!questions.length) {
    return null
  }

  return (
    <Space
      direction="vertical"
      size="small"
      style={{
        width: '100%',
        marginTop: 16,
      }}
    >
      <strong>继续探索</strong>

      {questions.slice(0, 3).map((question) => (
        <Button
          key={question}
          htmlType="button"
          disabled={disabled}
          style={{
            height: 'auto',
            whiteSpace: 'normal',
            textAlign: 'left',
          }}
          onClick={() => onAsk(question)}
        >
          {question}
        </Button>
      ))}
    </Space>
  )
}