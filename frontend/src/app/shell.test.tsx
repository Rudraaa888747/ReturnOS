import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Shell, isNavActive } from './Shell'
import { useAuth } from '../auth/AuthContext'
import type { Role } from '../lib/types'

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }))

function user(role: Role) {
  return { id: 'u1', email: 'u@x.dev', fullName: 'User', role, enabled: true }
}

function renderShell(role: Role, path: string) {
  vi.mocked(useAuth).mockReturnValue({ user: user(role), ready: true } as never)
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Shell />
    </MemoryRouter>,
  )
}

/** Sidebar nav is the first Primary landmark; assert its current link. */
function currentLabels(): string[] {
  const nav = screen.getAllByRole('navigation', { name: 'Primary' })[0]
  return within(nav)
    .getAllByRole('link', { current: 'page' })
    .map((a) => a.textContent ?? '')
}

describe('isNavActive', () => {
  it('matches sections without catching sibling form routes', () => {
    expect(isNavActive({ to: '/returns', label: 'My returns', match: 'section' }, '/returns')).toBe(true)
    expect(isNavActive({ to: '/returns', label: 'My returns', match: 'section' }, '/returns/abc')).toBe(true)
    expect(isNavActive({ to: '/returns', label: 'My returns', match: 'section' }, '/returns/new')).toBe(false)
    expect(isNavActive({ to: '/returns/new', label: 'New return', match: 'exact' }, '/returns/new')).toBe(true)
    expect(isNavActive({ to: '/returns/new', label: 'New return', match: 'exact' }, '/returns')).toBe(false)
    expect(isNavActive({ to: '/ops/returns', label: 'Work queue', match: 'section' }, '/ops/returns/x')).toBe(true)
    expect(isNavActive({ to: '/', label: 'Home', match: 'exact' }, '/returns')).toBe(false)
  })
})

describe('Shell navigation', () => {
  it('highlights only New return on /returns/new', () => {
    renderShell('CUSTOMER', '/returns/new')
    expect(currentLabels()).toEqual(['New return'])
  })

  it('highlights only My returns on /returns', () => {
    renderShell('CUSTOMER', '/returns')
    expect(currentLabels()).toEqual(['My returns'])
  })

  it('keeps My returns highlighted on a return detail page', () => {
    renderShell('CUSTOMER', '/returns/some-id')
    expect(currentLabels()).toEqual(['My returns'])
  })

  it('highlights only Work queue on /ops/returns for staff', () => {
    renderShell('WAREHOUSE_STAFF', '/ops/returns')
    expect(currentLabels()).toEqual(['Work queue'])
  })

  it('highlights only Operations on /ops for staff', () => {
    renderShell('WAREHOUSE_STAFF', '/ops')
    expect(currentLabels()).toEqual(['Operations'])
  })

  it('highlights only Control center on /admin', () => {
    renderShell('ADMIN', '/admin')
    expect(currentLabels()).toEqual(['Control center'])
  })
})
