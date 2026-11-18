import { Alert, Button, Card, Form, Input } from 'antd'
import axios from 'axios'
import { useState } from 'react'
import { login } from '../../api/user'
import { userActions } from '../../store/user'
import { useNavigate } from 'react-router-dom'

interface LoginValues {
  username: string
  password: string
}

export default function Login() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  async function handleLogin(values: LoginValues) {
    setLoading(true)
    setError('')

    try {
      const result = await login(values)
      userActions.setToken(result.access_token)
      navigate('/', { replace: true })
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        setError('用户名或密码错误')
      } else {
        setError('登录失败，请检查后端服务或稍后重试')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card
      title="登录 CiteMind"
      style={{ maxWidth: 400, margin: '80px auto' }}
    >
      {error && (
        <Alert
          type="error"
          message={error}
          showIcon
          style={{ marginBottom: 20 }}
        />
      )}

      <Form<LoginValues> layout="vertical" onFinish={handleLogin}>
        <Form.Item
          label="用户名"
          name="username"
          rules={[
            { required: true, whitespace: true, message: '请输入用户名' },
            { max: 50, message: '用户名不能超过 50 个字符' },
          ]}
        >
          <Input autoComplete="username" />
        </Form.Item>

        <Form.Item
          label="密码"
          name="password"
          rules={[{ required: true, message: '请输入密码' }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>

        <Button
          type="primary"
          htmlType="submit"
          loading={loading}
          block
        >
          登录
        </Button>
      </Form>
    </Card>
  )

  
}