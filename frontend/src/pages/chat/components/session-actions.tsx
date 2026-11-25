/**
 * 会话重命名和删除操作。
 *
 * 删除必须确认；请求期间禁止重复提交及关闭操作弹窗。
 */
import { Alert, Button, Dropdown, Input, Modal } from 'antd'
import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import { deleteSession, renameSession } from '../../../api/session'
import type { ChatSession } from '../../../api/session'

interface SessionActionsProps {
  session: ChatSession
  disabled: boolean
  onBusyChange: (busy: boolean) => void
  onRenamed: (session: ChatSession) => void
  onDeleted: (sessionId: string) => void
}

export default function SessionActions({
  session,
  disabled,
  onBusyChange,
  onRenamed,
  onDeleted,
}: SessionActionsProps) {
  const [mode, setMode] = useState<'rename' | 'delete' | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => controllerRef.current?.abort()
  }, [])

  /** 关闭尚未提交或已经结束的操作。 */
  function closeDialog(): void {
    if (!loading) {
      setMode(null)
      setError('')
    }
  }

  /** 执行当前已确认的操作，并通知父组件同步状态。 */
  async function handleSubmit(): Promise<void> {
    if (!mode || disabled || controllerRef.current) {
      return
    }

    const newName = name.trim()

    if (mode === 'rename' && !newName) {
      setError('会话名称不能为空')
      return
    }

    const controller = new AbortController()
    controllerRef.current = controller
    setLoading(true)
    setError('')
    onBusyChange(true)

    try {
      if (mode === 'rename') {
        const updated = await renameSession(
          session.session_id,
          newName,
          controller.signal,
        )

        if (!controller.signal.aborted) {
          setMode(null)
          onRenamed(updated)
        }
      } else {
        await deleteSession(session.session_id, controller.signal)

        if (!controller.signal.aborted) {
          setMode(null)
          onDeleted(session.session_id)
        }
      }
    } catch (error) {
      if (controller.signal.aborted || axios.isCancel(error)) {
        return
      }

      let description = '操作结果未确认，请刷新会话列表核对'

      if (axios.isAxiosError<{ detail?: unknown }>(error)) {
        const detail = error.response?.data?.detail
        if (typeof detail === 'string') {
          description = detail
        }
      }

      setError(description)
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false)
      }

      controllerRef.current = null

      // 删除成功后当前行可能卸载，共享的忙碌状态仍需要释放。
      onBusyChange(false)
    }
  }

  return (
    <>
      {/* 将次要操作收进菜单，保留原有确认弹窗及请求保护。 */}
      <Dropdown
        trigger={['click']}
        disabled={disabled}
        menu={{
          items: [
            { key: 'rename', label: '重命名' },
            { key: 'delete', label: '删除会话', danger: true },
          ],
          onClick: ({ key }) => {
            setError('')
            if (key === 'rename') {
              setName(session.session_name)
              setMode('rename')
            } else if (key === 'delete') {
              setMode('delete')
            }
          },
        }}
      >
        <Button
          className="session-more"
          type="text"
          disabled={disabled}
          aria-label={`管理会话：${session.session_name}`}
        >
          ···
        </Button>
      </Dropdown>

      <Modal
        title={mode === 'rename' ? '重命名会话' : '删除会话'}
        open={mode !== null}
        okText={mode === 'rename' ? '保存' : '确认删除'}
        cancelText="取消"
        confirmLoading={loading}
        okButtonProps={{
          danger: mode === 'delete',
          disabled: mode === 'rename' && !name.trim(),
        }}
        cancelButtonProps={{ disabled: loading }}
        closable={!loading}
        keyboard={!loading}
        maskClosable={false}
        onOk={() => void handleSubmit()}
        onCancel={closeDialog}
      >
        {mode === 'rename' ? (
          <Input
            value={name}
            maxLength={255}
            disabled={loading}
            onChange={(event) => setName(event.target.value)}
          />
        ) : (
          <p>
            确定删除“{session.session_name}”吗？
            该会话的全部问答和引用快照将一并删除，无法撤销。
          </p>
        )}

        {error && (
          <Alert type="error" showIcon message={error} style={{ marginTop: 16 }} />
        )}
      </Modal>
    </>
  )
}
