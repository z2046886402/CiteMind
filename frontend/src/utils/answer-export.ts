/**
 * 将完整问答快照转换为 Markdown，并发起浏览器下载。
 *
 * 仅使用已有数据，不重新查询文献或调用模型。
 * 问答内容与引用来源均不在导出过程中修改。
 */
import type { DocumentChatResult } from '../api/chat'

const STATUS_LABEL: Record<
  DocumentChatResult['status'],
  string
> = {
  generated: '已生成回答',
  no_evidence: '未找到可用资料',
  insufficient_evidence: '现有资料不足',
}

/** 转义行内 Markdown 字符，避免文件名等信息改变文档结构。 */
function escapeInline(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}\[\]<>()#!|])/g, '\\$1')
    .replace(/\r?\n/g, ' ')
}

/**
 * 使用纯文本代码块保存引用摘录。
 *
 * 分隔符长度超过摘录中的连续反引号长度，
 * 避免文献本身的反引号提前结束代码块。
 */
function fencedText(text: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce(
    (maximum, run) => Math.max(maximum, run.length),
    0,
  )

  const fence = '`'.repeat(
    Math.max(3, longest + 1),
  )

  return `${fence}text\n${text}\n${fence}`
}

/**
 * 构建单次问答的 Markdown 内容。
 *
 * @param result 已完成的当前问答或历史消息。
 * @param exportedAt 导出时间，允许传入固定时间进行验证。
 * @returns UTF-8 文本内容，不修改传入对象。
 */
export function buildAnswerMarkdown(
  result: DocumentChatResult,
  exportedAt: Date = new Date(),
): string {
  // 排序副本，避免改变页面中引用列表的顺序。
  const references = [...result.references].sort(
    (a, b) => a.citation_id - b.citation_id,
  )

  const knownIds = new Set(
    references.map((item) => item.citation_id),
  )

  // 保留回答原有 Markdown，只转换能找到对应来源的引用编号。
  // 未知标记保持原样，不静默删除。
  const answer = result.answer.replace(
    /##([0-9]+)\$\$/g,
    (marker, id: string) =>
      knownIds.has(Number(id))
        ? `[${Number(id)}]`
        : marker,
  )

  const sections = [
    '# CiteMind 文献问答笔记',

    '> 根据已完成的问答快照导出；页码描述整个来源分块。',

    [
      `- 导出时间：${exportedAt.toISOString()}`,
      `- 保存时间：${escapeInline(result.created_at ?? '未提供')}`,
      `- 问答状态：${STATUS_LABEL[result.status]}`,
      `- 会话内问答序号：${result.message_no ?? '未提供'}`,
      `- 回答模型：${escapeInline(result.model ?? '未调用')}`,
    ].join('\n'),

    '## 问题\n\n' +
      result.question
        .split(/\r?\n/)
        .map((line) => `> ${escapeInline(line)}`)
        .join('\n'),

    `## 回答\n\n${answer}`,

    '## 引用来源',
  ]

  if (!references.length) {
    sections.push('本次问答没有引用来源。')
  }

  for (const reference of references) {
    const pages = Array.from(
      new Set(reference.page_numbers ?? []),
    ).sort((a, b) => a - b)

    const tableLabel =
      reference.contains_table == null
        ? '未提供'
        : reference.contains_table
          ? '包含表格'
          : '不含表格'

    sections.push(
      [
        `### 引用 [${reference.citation_id}]`,
        '',
        `- 文献名称：${escapeInline(reference.file_name)}`,
        `- 文献 ID：${reference.document_id}`,
        `- 分块编号：${reference.chunk_index}`,
        `- 来源分块页码：${pages.length ? pages.join('、') : '未提供'}`,
        `- 来源分块表格信息：${tableLabel}`,
        `- 解析后全文字符范围：[${reference.start_char}, ${reference.end_char})`,
        '',
        '引用摘录：',
        '',
        fencedText(reference.content),
      ].join('\n'),
    )
  }

  if (result.warnings.length) {
    sections.push(
      '## 本次处理提示\n\n' +
        result.warnings
          .map((warning) => `- ${escapeInline(warning)}`)
          .join('\n'),
    )
  }

  return sections.join('\n\n') + '\n'
}

/**
 * 发起 Markdown 文件下载。
 *
 * 文件名使用时间戳，避免问题中的特殊字符影响 Windows 文件名。
 * 下载触发后延迟释放对象地址，给浏览器读取文件的时间。
 */
export function downloadAnswerMarkdown(
  result: DocumentChatResult,
): void {
  const exportedAt = new Date()
  const markdown = buildAnswerMarkdown(
    result,
    exportedAt,
  )

  // UTF-8 BOM 帮助部分 Windows 编辑器正确识别中文编码。
  const blob = new Blob(
    ['\uFEFF', markdown],
    { type: 'text/markdown;charset=utf-8' },
  )

  const anchor = document.createElement('a')
  const url = URL.createObjectURL(blob)

  try {
    anchor.href = url
    anchor.download =
      'CiteMind-问答-' +
      exportedAt.toISOString().replace(/[:.]/g, '-') +
      '.md'

    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
  } finally {
    anchor.remove()

    window.setTimeout(
      () => URL.revokeObjectURL(url),
      1000,
    )
  }
}