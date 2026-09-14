import { clearToken, request, storeToken } from '../lib/api'
import type { AuthResponse, Role, User } from '../lib/types'

export async function login(email: string, password: string): Promise<User> {
  const res = await request<AuthResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  })
  storeToken(res.token)
  return res.user
}

export async function register(email: string, password: string, fullName: string): Promise<User> {
  const res = await request<AuthResponse>('/api/v1/auth/register', {
    method: 'POST',
    body: { email, password, fullName },
    auth: false,
  })
  storeToken(res.token)
  return res.user
}

export function logout(): void {
  clearToken()
}

export async function currentUser(): Promise<User> {
  return request<User>('/api/v1/auth/me')
}

export async function createUser(
  email: string,
  password: string,
  fullName: string,
  role: Role,
): Promise<User> {
  const res = await request<AuthResponse>('/api/v1/auth/users', {
    method: 'POST',
    body: { email, password, fullName, role },
  })
  return res.user
}
