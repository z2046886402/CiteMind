/**
 * 解析并展示 Markdown 回答，同时保留引用查看功能。
 *
 * 使用独立的 Marked 实例生成 Token，再转换为 React 元素。
 * 原始 HTML 按文字显示；代码块内的引用标记保持原样。
 */
import { Button } from 'antd'
import { Marked } from 'marked'
import type { MarkedToken, Token } from 'marked'
import { createElement, Fragment, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { AnswerReference } from '../../../api/chat'
import './cited-answer.css'

interface CitedAnswerProps {
  answer: string
  references: AnswerReference[]
  onReadReference: (reference: AnswerReference) => void
}

interface CitationToken {
  type: 'citation'
  raw: string
  citationId: number
}

/**
 * 引用作为行内语法参与解析，因此不会处理代码块里的标记。
 * 独立实例避免修改其他组件使用的 Marked 全局配置。
 */
const markdown = new Marked({
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: 'citation',
      level: 'inline',

      start(source) {
        return source.match(/##[0-9]+\$\$/)?.index
      },

      tokenizer(source) {
        const match = /^##([0-9]+)\$\$/.exec(source)

        if (!match) {
          return
        }

        return {
          type: 'citation',
          raw: match[0],
          citationId: Number(match[1]),
        }
      },
    },
  ],
})

/** 解码常见文字实体，不解析 HTML，也不创建 DOM 节点。 */
function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00a0',
  }

  return text.replace(
    /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi,
    (raw, entity: string) => {
      if (!entity.startsWith('#')) {
        return named[entity.toLowerCase()] ?? raw
      }

      const value =
        entity[1]?.toLowerCase() === 'x'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10)

      return (
        value > 0 &&
        value <= 0x10ffff &&
        !(value >= 0xd800 && value <= 0xdfff)
      )
        ? String.fromCodePoint(value)
        : '\ufffd'
    },
  )
}

/** 仅将完整的 HTTP、HTTPS 地址转换为可点击链接。 */
function safeHref(value: string): string | undefined {
  try {
    const url = new URL(value)

    return ['http:', 'https:'].includes(url.protocol)
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

export default function CitedAnswer({
  answer,
  references,
  onReadReference,
}: CitedAnswerProps) {
  const tokens = useMemo(
    () => markdown.lexer(answer),
    [answer],
  )

  const referenceMap = useMemo(
    () =>
      new Map(
        references.map((reference) => [
          reference.citation_id,
          reference,
        ]),
      ),
    [references],
  )

  /** 递归展示嵌套结构，例如列表里的加粗文字和引用。 */
  function renderTokens(
    items: Token[],
    insideLink = false,
  ): ReactNode {
    return items.map((item, index) => (
      <Fragment key={index}>
        {renderToken(item, insideLink)}
      </Fragment>
    ))
  }

  function renderToken(
    item: Token,
    insideLink: boolean,
  ): ReactNode {
    if (item.type === 'citation') {
      const citation = item as CitationToken
      const reference = referenceMap.get(
        citation.citationId,
      )

      // 未知编号保留原文，不创建没有来源的引用按钮。
      if (!reference) {
        return citation.raw
      }

      // 避免在外部链接内部嵌套另一个可交互按钮。
      if (insideLink) {
        return `[${reference.citation_id}]`
      }

      return (
        <Button
          type="link"
          size="small"
          className="citemind-citation"
          aria-label={`查看引用 ${reference.citation_id}`}
          onClick={() => onReadReference(reference)}
        >
          [{reference.citation_id}]
        </Button>
      )
    }

    // 当前解析器仅注册了上述引用扩展，其余为标准 Markdown Token。
    const token = item as MarkedToken

    switch (token.type) {
      case 'space':
      case 'def':
        return null

      case 'heading':
        return createElement(
          `h${Math.max(1, Math.min(6, token.depth))}`,
          {},
          renderTokens(token.tokens),
        )

      case 'paragraph':
        return (
          <p>{renderTokens(token.tokens, insideLink)}</p>
        )

      case 'text':
        return token.tokens
          ? renderTokens(token.tokens, insideLink)
          : decodeEntities(token.text)

      case 'escape':
        return token.text

      case 'strong':
        return (
          <strong>
            {renderTokens(token.tokens, insideLink)}
          </strong>
        )

      case 'em':
        return (
          <em>{renderTokens(token.tokens, insideLink)}</em>
        )

      case 'del':
        return (
          <del>{renderTokens(token.tokens, insideLink)}</del>
        )

      case 'br':
        return <br />

      case 'hr':
        return <hr />

      case 'blockquote':
        return (
          <blockquote>
            {renderTokens(token.tokens)}
          </blockquote>
        )

      case 'code':
        return (
          <pre>
            <code>{token.text}</code>
          </pre>
        )

      case 'codespan':
        return <code>{token.text}</code>

      case 'list': {
        const children = token.items.map(
          (entry, index) => (
            <li key={index}>
              {entry.task
                ? entry.checked
                  ? '☑ '
                  : '☐ '
                : null}

              {renderTokens(entry.tokens)}
            </li>
          ),
        )

        return token.ordered ? (
          <ol start={Number(token.start) || 1}>
            {children}
          </ol>
        ) : (
          <ul>{children}</ul>
        )
      }

      case 'list_item':
        return <li>{renderTokens(token.tokens)}</li>

      case 'table':
        return (
          <div className="citemind-markdown-table">
            <table>
              <thead>
                <tr>
                  {token.header.map((cell, index) => (
                    <th
                      key={index}
                      style={{
                        textAlign: cell.align ?? undefined,
                      }}
                    >
                      {renderTokens(cell.tokens)}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {token.rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((cell, column) => (
                      <td
                        key={column}
                        style={{
                          textAlign: cell.align ?? undefined,
                        }}
                      >
                        {renderTokens(cell.tokens)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )

      case 'link': {
        const href = safeHref(token.href)
        const children = renderTokens(
          token.tokens,
          true,
        )

        return href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        ) : (
          children
        )
      }

      case 'image':
        return (
          <span>
            [图片：{decodeEntities(token.text)}]
          </span>
        )

      case 'html':
        return token.text

      default:
        return item.raw
    }
  }

  return (
    <div className="citemind-markdown">
      {renderTokens(tokens)}
    </div>
  )
}