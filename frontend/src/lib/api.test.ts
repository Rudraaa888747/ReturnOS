import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiError, friendlyMessage, getToken, setToken } from './api'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('api client', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('attaches the stored bearer token to requests', async () => {
    setToken('test-token')
    expect(getToken()).toBe('test-token')

    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit): Promise<Response> =>
      jsonResponse(200, { ok: true }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    await api<{ ok: boolean }>('/orders')
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined
    expect(headers?.Authorization).toBe('Bearer test-token')
  })

  it('sends no authorization header when logged out', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit): Promise<Response> =>
      jsonResponse(200, { ok: true }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    await api<{ ok: boolean }>('/meta/constants')
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined
    expect(headers?.Authorization).toBeUndefined()
  })

  it('throws ApiError with code and validation details on failure', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit): Promise<Response> =>
      jsonResponse(400, {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        errors: [{ path: 'items.0.quantity', message: 'Quantity must be at least 1' }],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    const failure = await api('/returns').then(
      () => null,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(ApiError)
    const apiError = failure as ApiError
    expect(apiError.status).toBe(400)
    expect(apiError.code).toBe('VALIDATION_ERROR')
    expect(apiError.errors).toHaveLength(1)
    expect(friendlyMessage(apiError)).toBe('Request validation failed')
  })

  it('maps anonymous failures to a generic message', () => {
    expect(friendlyMessage(new Error('Network down'))).toBe('Network down')
    expect(friendlyMessage(null)).toBe('Something went wrong. Please try again.')
  })
})
