/** 提供会话创建、分页列表和选择入口。 */
import { Alert, Button, Card, Empty, Input, Pagination, Space } from 'antd'
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
    <Card
      title="我的会话"
      loading={loading}
      extra={
        <Button
          disabled={disabled || loading}
          onClick={() => setRefreshToken((value) => value + 1)}
        >
          刷新列表
        </Button>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space wrap>
          <Input
            value={name}
            maxLength={255}
            disabled={disabled}
            placeholder="名称留空时，首条问答后自动生成标题"
            style={{ width: 280 }}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            type="primary"
            loading={creating}
            disabled={disabled}
            onClick={() => void handleCreate()}
          >
            新建会话
          </Button>
        </Space>

        {error && <Alert type="error" showIcon message={error} />}

        {sessions.map((session) => (
          <div
            key={session.session_id}
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
          >
            <Button
              type={activeId === session.session_id ? 'primary' : 'default'}
              disabled={disabled}
              onClick={() => onSelect(session)}
              style={{
                flex: 1,
                minWidth: 160,
                height: 'auto',
                whiteSpace: 'normal',
              }}
            >
              {session.session_name}
            </Button>

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
                // 删除当前页最后一项时也回到第一页，避免停留在空页。
                setPage(1)
                setRefreshToken((value) => value + 1)
                onDeleted(sessionId)
              }}
            />
          </div>
        ))}

        {!error && sessions.length === 0 && (
          <Empty description="暂无会话，请先新建" />
        )}

        <Pagination
          current={page}
          pageSize={8}
          total={total}
          disabled={disabled}
          showSizeChanger={false}
          hideOnSinglePage
          onChange={setPage}
        />
      </Space>
    </Card>
  )
}