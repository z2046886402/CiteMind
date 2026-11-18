import { proxy } from 'valtio'

const TOKEN_KEY = 'citemind_token'

export const userState = proxy({
  token: localStorage.getItem(TOKEN_KEY) || '',
})

export const userActions = {
  setToken(token: string) {
    localStorage.setItem(TOKEN_KEY, token)
    userState.token = token
  },

  logout() {
    localStorage.removeItem(TOKEN_KEY)
    userState.token = ''
  },
}