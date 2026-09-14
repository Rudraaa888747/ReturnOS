/* Centralized API client: base URL, JWT, typed errors, auth expiry handling. */

import type { ApiError } from './types'

const TOKEN_KEY = 'returnos.token'

export function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function storeToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable: session simply won't persist */
  }
}

export class ApiRequestError extends Error {
  status: number
  code: string
  fields?: Record<string, string>

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export class NetworkError extends Error {
  constructor() {
    super('Could not reach the ReturnOS service. Check your connection and try again.')
    this.name = 'NetworkError'
  }
}

function baseUrl(): string {
  const configured = import.meta.env.VITE_API_URL as string | undefined
  return (configured ?? '').replace(/\/$/, '')
}

export interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
  auth?: boolean
  onUnauthorized?: () => void
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, auth = true, onUnauthorized } = options
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = readToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new NetworkError()
  }

  if (response.status === 204) return undefined as T
  const text = await response.text()
  const payload = text ? (JSON.parse(text) as T & Partial<ApiError>) : ({} as T)

  if (!response.ok) {
    if (response.status === 401) {
      clearToken()
      onUnauthorized?.()
      throw new ApiRequestError(401, 'UNAUTHORIZED', 'Your session expired. Sign in again.')
    }
    const err = payload as Partial<ApiError>
    throw new ApiRequestError(
      response.status,
      err.code ?? 'REQUEST_FAILED',
      err.message ?? `Request failed (${response.status}).`,
      err.errors,
    )
  }
  return payload as T
}

/** Human copy for failures. Passes through app-created messages; never leaks fetch internals. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message
  if (error instanceof NetworkError) return error.message
  if (error instanceof DOMException && error.name === 'AbortError') return ''
  if (error instanceof TypeError) return 'Something unexpected happened. Try again.'
  if (error instanceof Error && error.message) return error.message
  return 'Something unexpected happened. Try again.'
}
