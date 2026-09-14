import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiRequestError, NetworkError, errorMessage, request } from './api'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('api client', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('sends the stored token and parses success bodies', async () => {
    sessionStorage.setItem('returnos.token', 'abc')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const data = await request<{ ok: boolean }>('/api/v1/auth/me')
    expect(data).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/me',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer abc' }) }),
    )
  })

  it('maps backend validation errors with field details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(400, { code: 'VALIDATION_FAILED', message: 'Request validation failed', errors: { email: 'bad' } }),
      ),
    )
    const err = await request('/x').catch((e) => e)
    expect(err).toBeInstanceOf(ApiRequestError)
    expect((err as ApiRequestError).fields).toEqual({ email: 'bad' })
    expect(errorMessage(err)).toBe('Request validation failed')
  })

  it('clears the session and explains expiry on 401', async () => {
    sessionStorage.setItem('returnos.token', 'stale')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {})))
    const err = await request('/x').catch((e) => e)
    expect(err).toBeInstanceOf(ApiRequestError)
    expect(sessionStorage.getItem('returnos.token')).toBeNull()
    expect(errorMessage(err)).toMatch(/expired/i)
  })

  it('reports network failures in human words', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const err = await request('/x').catch((e) => e)
    expect(err).toBeInstanceOf(NetworkError)
    expect(errorMessage(err)).toMatch(/connection/i)
  })
})
