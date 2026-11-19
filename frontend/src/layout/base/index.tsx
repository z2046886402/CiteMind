import { Button, Layout, Space } from 'antd'
import { Link, Outlet } from 'react-router-dom'
import { userActions } from '../../store/user'


export default function BaseLayout() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header
        style={{
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Space size="large">
          <strong>CiteMind</strong>
          <Link to="/">首页</Link>
          <Link to="/repository">知识库</Link>
          <Link to="/search">文献检索</Link>
          <Link to="/chat">文献问答</Link>
        </Space>

        <Button onClick={() => userActions.logout()}>
          退出登录
        </Button>
      </Layout.Header>

      <Layout.Content style={{ padding: 24 }}>
        <Outlet />
      </Layout.Content>
    </Layout>
  )
}