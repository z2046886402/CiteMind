/** 提供会话创建、分页列表和选择入口。 */
import { Alert, Button, Empty, Input, Pagination, Spin } from 'antd'
import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import { createSession, listSessions } from '../../../api/session'
import type { ChatSession } from '../../../api/session'
import SessionActions from './session-actions'

interface SessionPanelProps {
  activeId?: string
  disabled: boolean
  reloadToken: number
  onSelect: (session: ChatSession) => void
  onBusyChange: (busy: boolean) => void
  onRenamed: (session: ChatSession) => void
  onDeleted: (sessionId: string) => void
}

export default function SessionPanel({
  activeId,
  disabled,
  reloadToken,
  onSelect,
  onBusyChange,
  onRenamed,
  onDeleted,
}: SessionPanelProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)
  const createController = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')

    listSessions(page, 8, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setSessions(data.sessions)
          setTotal(data.total)
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && !axios.isCancel(error)) {
          setError('会话列表加载失败，请刷新重试')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [page, reloadToken, refreshToken])

  useEffect(() => {
    return () => createController.current?.abort()
  }, [])

  /** 创建成功后选中新会话，并重新查询第一页列表。 */
  async function handleCreate(): Promise<void> {
    if (disabled || createController.current) {
      return
    }

    const controller = new AbortController()
    createController.current = controller
    setCreating(true)
    setError('')
    onBusyChange(true)

    try {
      const session = await createSession(
        name.trim() || '新会话',
        controller.signal,
        !name.trim(),
      )

      if (!controller.signal.aborted) {
        setName('')
        setPage(1)
        setRefreshToken((value) => value + 1)
        onSelect(session)
      }
    } catch (error) {
      if (!controller.signal.aborted && !axios.isCancel(error)) {
        setError('会话创建结果未确认，请先刷新列表检查')
      }
    } finally {
      if (!controller.signal.aborted) {
        setCreating(false)
        onBusyChange(false)
      }
      createController.current = null
    }
  }

  return (
    <section className="session-panel">
      <div className="session-heading">
        <span>研究会话</span>
        <Button
          type="text"
          size="small"
          disabled={disabled || loading}
          onClick={() => setRefreshToken((value) => value + 1)}
        >
          刷新
        </Button>
      </div>
      <div className="session-create">
        <Button
          type="primary"
          block
          loading={creating}
          disabled={disabled}
          onClick={() => void handleCreate()}
        >
          <span aria-hidden="true">＋</span> 新建会话
        </Button>
        <Input
          value={name}
          maxLength={255}
          disabled={disabled || creating}
          placeholder="会话名称（可留空）"
          aria-label="新会话名称"
          onChange={(event) => setName(event.target.value)}
          onPressEnter={() => void handleCreate()}
        />
      </div>
      <div className="session-list-heading">
        最近会话 <span>{total}</span>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      <Spin spinning={loading}>
        <div className="session-list">
          {sessions.map((session) => (
            <div
              key={session.session_id}
              className={`session-row${activeId === session.session_id ? ' is-active' : ''}`}
            >
              <button
                type="button"
                className="session-select"
                disabled={disabled}
                aria-current={activeId === session.session_id ? 'true' : undefined}
                onClick={() => onSelect(session)}
                title={session.session_name}
              >
                <span className="session-row-icon" aria-hidden="true">
                  ▤
                </span>
                <span className="session-row-name">{session.session_name}</span>
              </button>
              <SessionActions
                session={session}
                disabled={disabled}
                onBusyChange={onBusyChange}
                onRenamed={(updated) => {
                  setPage(1)
                  setRefreshToken((value) => value + 1)
                  onRenamed(updated)
                }}
                onDeleted={(sessionId) => {
                  // 删除当前页最后一项后回到第一页，避免停留在空页。
                  setPage(1)
                  setRefreshToken((value) => value + 1)
                  onDeleted(sessionId)
                }}
              />
            </div>
          ))}
          {!loading && !error && sessions.length === 0 && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="从新建会话开始研究"
            />
          )}
        </div>
      </Spin>
      <Pagination
        size="small"
        current={page}
        pageSize={8}
        total={total}
        disabled={disabled}
        showSizeChanger={false}
        hideOnSinglePage
        onChange={setPage}
      />
      <div className="session-footnote">
        <span className="session-status-dot" />
        你的文献，你的研究空间
      </div>
    </section>
  )
}
