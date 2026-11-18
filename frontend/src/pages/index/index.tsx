import { Alert, Button, Card } from 'antd'
import { useState } from 'react'
import { getCurrentUser } from '../../api/user'

export default function Home() {
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function checkIdentity() {
    setLoading(true)
    setMessage('')

    try {
      const result = await getCurrentUser()
      setMessage(`身份验证通过：${result.username}，编号 ${result.user_id}`)
    } catch {
      setMessage('验证失败，请检查后端服务或重新登录')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card title="欢迎使用 CiteMind">
      <p>基于 RAG 的文献检索与可信问答系统</p>

      <Button
        type="primary"
        loading={loading}
        onClick={checkIdentity}
      >
        验证当前身份
      </Button>

      {message && (
        <Alert
          message={message}
          type="info"
          style={{ marginTop: 20 }}
        />
      )}
    </Card>
  )
}