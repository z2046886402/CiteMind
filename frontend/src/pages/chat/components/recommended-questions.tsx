/**
 * 展示已经随回答保存的推荐追问。
 *
 * 本组件只负责展示和通知父页面，不自行发送问答请求。
 */
import { Button } from 'antd'

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
    <div className="chat-recommendations">
      <span className="chat-recommendations-label">继续探索</span>
      <div className="chat-recommendations-list">
        {questions.slice(0, 3).map((question) => (
          <Button
            key={question}
            htmlType="button"
            disabled={disabled}
            onClick={() => onAsk(question)}
          >
            {question}
            <span aria-hidden="true">↗</span>
          </Button>
        ))}
      </div>
    </div>
  )
}
