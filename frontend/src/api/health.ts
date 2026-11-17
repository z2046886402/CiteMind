import { request } from './request'

interface HealthResponse {
  status: string
  message: string
}

export async function getHealth() {
  const response = await request.get<HealthResponse>('/health')
  return response.data
}