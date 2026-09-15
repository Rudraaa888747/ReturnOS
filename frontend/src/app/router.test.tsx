import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { appRoutes } from './router'
import { useAuth } from '../auth/AuthContext'

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }))

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return render(<RouterProvider router={router} />)
}

describe('app routes', () => {
  it('serves the public homepage at / instead of bouncing visitors to login', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, ready: true } as never)
    renderAt('/')

    expect(
      // Lazy homepage chunk can be slow to transform under parallel workers.
      await screen.findByRole('heading', { name: 'The operating system for reverse logistics.' }, { timeout: 10000 }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('keeps /login public and rendering', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, ready: true } as never)
    renderAt('/login')

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})
