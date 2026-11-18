import { createBrowserRouter } from 'react-router-dom'
import BaseLayout from '../layout/base'
import Home from '../pages/index'
import Login from '../pages/login'
import Repository from '../pages/repository'
import { AuthGuard } from './guard/auth'

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <Login />,
  },
  {
    element: <AuthGuard />,
    children: [
      {
        path: '/',
        element: <BaseLayout />,
        children: [
          {
            index: true,
            element: <Home />,
          },
          {
            path: 'repository',
            element: <Repository />,
          },
        ],
      },
    ],
  },
  {
    path: '*',
    element: <p>页面不存在，请检查地址。</p>,
  },
])