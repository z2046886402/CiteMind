/**
 * 定义流式问答错误及统一的页面提示规则。
 *
 * 保存结果无法确认时引导查询历史，不自动重新发送问题。
 */
export type ChatFailureKind =
  | 'http'
  | 'server'
  | 'timeout'
  | 'network'
  | 'protocol'
  | 'incomplete'

export class ChatStreamError extends Error {
  readonly kind: ChatFailureKind
  readonly httpStatus?: number
  readonly serverCode?: string

  constructor(
    kind: ChatFailureKind,
    message: string,
    options: {
      httpStatus?: number
      serverCode?: string
    } = {},
  ) {
    super(message)
    this.name = 'ChatStreamError'
    this.kind = kind
    this.httpStatus = options.httpStatus
    this.serverCode = options.serverCode
  }
}

export interface ChatNotice {
  type: 'info' | 'warning' | 'error'
  title: string
  description: string
  checkHistory: boolean
  clearSession: boolean
}

/** 将错误转换为页面提示，所有后续操作文案集中维护。 */
export function getChatNotice(
  error: unknown,
): ChatNotice {
  function pending(
    title: string,
    description: string,
  ): ChatNotice {
    return {
      type: 'warning',
      title,
      description,
      checkHistory: true,
      clearSession: false,
    }
  }

  function rejected(
    title: string,
    description: string,
    clearSession = false,
  ): ChatNotice {
    return {
      type: 'error',
      title,
      description,
      checkHistory: false,
      clearSession,
    }
  }

  if (!(error instanceof ChatStreamError)) {
    return pending(
      '处理结果待确认',
      '未能确认本次问答结果，请核对会话历史后再决定是否重试。',
    )
  }

  switch (error.kind) {
    case 'timeout':
      return pending(
        '等待超时',
        '浏览器已结束本次等待，后端可能仍在处理。请核对会话历史，稍后可再次刷新。',
      )

    case 'network':
      return pending(
        '连接中断',
        '未能完整接收问答结果。请检查网络或后端服务，并核对会话历史后再决定是否重试。',
      )

    case 'protocol':
      return pending(
        '响应格式异常',
        '收到的问答数据不完整或格式不正确，请核对会话历史后再决定是否重试。',
      )

    case 'incomplete':
      return pending(
        '连接提前结束',
        '尚未收到保存成功通知，请核对会话历史后再决定是否重试。',
      )

    case 'http':
      if (error.httpStatus === 401) {
        return rejected(
          '登录已失效',
          '请重新登录后继续问答。',
        )
      }

      if (
        error.httpStatus === 403 ||
        error.httpStatus === 404
      ) {
        return rejected(
          '会话不可用',
          '请选择其他会话或新建会话。',
          true,
        )
      }

      if (
        error.httpStatus === 400 ||
        error.httpStatus === 422
      ) {
        return rejected(
          '问题未能提交',
          '请检查问题内容和请求参数后重新提交。',
        )
      }

      if (error.httpStatus === 429) {
        return rejected(
          '请求过于频繁',
          '请稍后再试。',
        )
      }

      return pending(
        '请求未正常完成',
        '请核对会话历史后，再决定是否重新提交问题。',
      )

    case 'server':
      if (error.serverCode === 'SESSION_NOT_FOUND') {
        return rejected(
          '会话已不存在',
          '请选择其他会话或新建会话。',
          true,
        )
      }

      if (error.serverCode === 'ANSWER_FAILED') {
        return rejected(
          '问答未完成',
          error.message ||
            '请检查模型服务、文献索引或问题内容后重试。',
        )
      }

      if (error.serverCode === 'SAVE_UNCONFIRMED') {
        return pending(
          '保存结果待确认',
          '回答已生成，但保存结果尚未确认。请核对会话历史后再决定是否重试。',
        )
      }

      return pending(
        '处理结果待确认',
        '服务端未能确认本次处理结果，请核对会话历史后再决定是否重试。',
      )
  }
}

/** 主动停止只表示浏览器停止接收，不承诺撤销后端处理。 */
export function stoppedChatNotice(): ChatNotice {
  return {
    type: 'info',
    title: '已停止接收',
    description:
      '浏览器已停止接收回答，后端可能仍在处理。请核对会话历史，稍后可再次刷新。',
    checkHistory: true,
    clearSession: false,
  }
}