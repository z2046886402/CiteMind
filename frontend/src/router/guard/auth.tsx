import { Navigate, Outlet } from 'react-router-dom'
import { useSnapshot } from 'valtio'
import { userState } from '../../store/user'

export function AuthGuard() {
  const user = useSnapshot(userState)

  if (!user.token) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}