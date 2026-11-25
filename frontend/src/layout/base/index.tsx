/** 应用导航外壳；聊天路由使用独立视口，让输入框保持在工作区底部。 */
import { Button, Layout } from 'antd'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { userActions } from '../../store/user'
import './index.css'

export default function BaseLayout() {
  const isChat = useLocation().pathname.replace(/\/$/, '') === '/chat'
  return (
    <Layout className={`citemind-shell${isChat ? ' is-chat' : ''}`}>
      <Layout.Header className="citemind-header">
        <NavLink to="/" className="citemind-brand">
          <span className="citemind-brand-mark" aria-hidden="true">
            C.
          </span>
          <strong>CiteMind</strong>
          <span className="citemind-brand-caption">文献研究工作台</span>
        </NavLink>
        <nav className="citemind-navigation" aria-label="主导航">
          <NavLink to="/" end>
            首页
          </NavLink>
          <NavLink to="/repository">知识库</NavLink>
          <NavLink to="/search">文献检索</NavLink>
          <NavLink to="/chat">文献问答</NavLink>
        </nav>
        <Button
          type="text"
          className="citemind-logout"
          onClick={() => userActions.logout()}
        >
          退出登录
        </Button>
      </Layout.Header>
      <Layout.Content className="citemind-content">
        <Outlet />
      </Layout.Content>
    </Layout>
  )
}
