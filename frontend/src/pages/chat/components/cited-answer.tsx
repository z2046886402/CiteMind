/**
 * 展示回答正文，将 ##编号$$ 转换为可点击的引用按钮。
 *
 * 所有正文均按 React 文本节点渲染，不执行回答中的 HTML。
 */
import { Button } from 'antd'
import { Fragment } from 'react'
import type { AnswerReference } from '../../../api/chat'

interface CitedAnswerProps {
  answer: string
  references: AnswerReference[]
  onReadReference: (reference: AnswerReference) => void
}

export default function CitedAnswer({
  answer,
  references,
  onReadReference,
}: CitedAnswerProps) {
  const referenceMap = new Map(
    references.map((reference) => [
      reference.citation_id,
      reference,
    ]),
  )

  // 捕获组保留引用标记，使正文与标记按原顺序交替排列。
  const parts = answer.split(/(##[0-9]+\$\$)/g)

  return (
    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 2 }}>
      {parts.map((part, index) => {
        const match = /^##([0-9]+)\$\$$/.exec(part)
        const reference = match
          ? referenceMap.get(Number(match[1]))
          : undefined

        if (!reference) {
          return <Fragment key={index}>{part}</Fragment>
        }

        return (
          <Button
            key={index}
            type="link"
            size="small"
            aria-label={`查看引用 ${reference.citation_id}`}
            onClick={() => onReadReference(reference)}
          >
            [{reference.citation_id}]
          </Button>
        )
      })}
    </div>
  )
}