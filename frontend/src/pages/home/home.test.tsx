import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import HomeRoute from './HomeRoute'
import { useAuth } from '../../auth/AuthContext'

vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../services/returns', () => ({ listReturns: vi.fn() }))

const admin = { id: 'a1', email: 'a@x.dev', fullName: 'Admin', role: 'ADMIN', enabled: true }
const staff = { id: 's1', email: 's@x.dev', fullName: 'Staff', role: 'WAREHOUSE_STAFF', enabled: true }

function renderRoot() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/home" element={<p>inside-shell home</p>} />
        <Route path="/admin" element={<p>admin console</p>} />
        <Route path="/ops" element={<p>operations console</p>} />
        <Route path="/login" element={<p>login screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HomeRoute', () => {
  it('shows the public homepage to visitors', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, ready: true } as never)
    renderRoot()

    expect(
      await screen.findByRole('heading', { name: 'The operating system for reverse logistics.' }, { timeout: 10000 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Choose your workspace' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'One return. One connected journey.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Every return has an outcome.' })).toBeInTheDocument()

    const workspaces = screen.getByRole('heading', { name: 'Choose your workspace' }).closest('section')!
    const links = within(workspaces).getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual(
      expect.arrayContaining(['/returns', '/ops', '/admin']),
    )
  })

  it('sends signed-in users to the in-shell home instead of the homepage', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: admin, ready: true } as never)
    renderRoot()
    expect(await screen.findByText('inside-shell home')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'The operating system for reverse logistics.' })).not.toBeInTheDocument()
  })

  it('sends signed-in warehouse staff to the in-shell home too', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: staff, ready: true } as never)
    renderRoot()
    expect(await screen.findByText('inside-shell home')).toBeInTheDocument()
  })

  it('animates the hero product visual from a calm received snapshot', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, ready: true } as never)
    renderRoot()

    expect(await screen.findAllByText('RET-2026-0841', {}, { timeout: 10000 })).toHaveLength(2)
    expect(screen.getByText(/Record inspection/)).toBeInTheDocument()
  })

  it('describes the product with real lifecycle stages', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, ready: true } as never)
    renderRoot()

    const heading = await screen.findByRole('heading', { name: 'One return. One connected journey.' })
    const section = heading.closest('section')!
    for (const stage of [
      'Return request',
      'Policy check',
      'Approval',
      'Receive',
      'Inspection',
      'Risk + disposition',
      'Resolution',
    ]) {
      expect(within(section).getByText(stage)).toBeInTheDocument()
    }
  })
})
