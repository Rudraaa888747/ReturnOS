import { describe, expect, it } from 'vitest'
import { isKnownAppPath, resolvePostLoginPath } from './routes'

const UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6'

describe('isKnownAppPath', () => {
  it.each([
    '/home',
    '/returns',
    '/returns/new',
    '/ops',
    '/ops/returns',
    '/ops/tasks',
    '/admin',
    '/admin/tasks',
    '/admin/audit',
    `/returns/${UUID}`,
    `/ops/returns/${UUID}`,
  ])('accepts the real route %s', (path) => {
    expect(isKnownAppPath(path)).toBe(true)
  })

  it.each([
    '/does-not-exist',
    '/old-dashboard',
    '/random',
    '/admin/fake-page',
    '/ops/not-real',
    '/returns/not-a-uuid',
    '/returns/new/extra',
    '/returns/',
    'https://evil.example/ops',
    '//evil.example/ops',
    '/ops/returns/../../admin',
    '/ops\\returns',
    `/returns/${UUID}/extra`,
    '',
  ])('rejects %s', (path) => {
    expect(isKnownAppPath(path)).toBe(false)
  })

  it('rejects non-strings and traversal tricks', () => {
    expect(isKnownAppPath(undefined as never)).toBe(false)
    expect(isKnownAppPath(null as never)).toBe(false)
    expect(isKnownAppPath(`/ops/returns/%2e%2e/admin`)).toBe(false)
  })
})

describe('resolvePostLoginPath', () => {
  it('preserves valid remembered paths', () => {
    expect(resolvePostLoginPath('/ops/returns')).toBe('/ops/returns')
    expect(resolvePostLoginPath(`/returns/${UUID}`)).toBe(`/returns/${UUID}`)
  })

  it('falls back to the role-aware root for stale or invalid paths', () => {
    expect(resolvePostLoginPath('/old-dashboard')).toBe('/')
    expect(resolvePostLoginPath('/does-not-exist')).toBe('/')
    expect(resolvePostLoginPath(undefined)).toBe('/')
    expect(resolvePostLoginPath(null)).toBe('/')
    expect(resolvePostLoginPath(42)).toBe('/')
  })
})
