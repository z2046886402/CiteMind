import axios from 'axios'
import { userActions, userState } from '../store/user'

export const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE,
  timeout: 10000,
})

request.interceptors.request.use((config) => {
  if (userState.token && config.url !== '/login') {
    config.headers.Authorization = `Bearer ${userState.token}`
  }

  return config
})

request.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      error.config?.url !== '/login'
    ) {
      userActions.logout()
    }

    return Promise.reject(error)
  },
)