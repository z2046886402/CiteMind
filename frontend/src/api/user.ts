import { request } from './request'

interface LoginParams {
  username: string
  password: string
}

interface LoginResponse {
  access_token: string
  token_type: string
}

export interface CurrentUser {
  user_id: number
  username: string
}

export async function login(params: LoginParams) {
  const response = await request.post<LoginResponse>('/login', params)
  return response.data
}

export async function getCurrentUser() {
  const response = await request.get<CurrentUser>('/users/me')
  return response.data
}