import { useState } from 'react'
import { getHealth } from './api/health'

export default function App() {
  const [message, setMessage] = useState('尚未检查后端连接')
  const [loading, setLoading] = useState(false)

  async function checkBackend() {
    setLoading(true)

    try {
      const result = await getHealth()
      setMessage(result.message)
    } catch {
      setMessage('连接失败，请检查后端是否启动，以及接口地址是否正确')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main>
      <h1>CiteMind</h1>
      <p>基于 RAG 的文献检索与可信问答系统</p>

      <button onClick={checkBackend} disabled={loading}>
        {loading ? '检查中…' : '检查后端连接'}
      </button>

      <p>{message}</p>
    </main>
  )
}