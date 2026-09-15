import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { appRoutes } from './router'
import { useAuth } from '../auth/AuthContext'
import { listOrders } from '../services/catalog'
import { ToastProvider } from '../components/feedback'

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../services/catalog', () => ({ listOrders: vi.fn() }))

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

  it('lets warehouse staff open the return composer (no fake 403)', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 's1', email: 's@x.dev', fullName: 'Staff', role: 'WAREHOUSE_STAFF', enabled: true },
      ready: true,
    } as never)
    vi.mocked(listOrders).mockResolvedValue({ content: [], totalElements: 0, totalPages: 0, number: 0, size: 20 })
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/returns/new'] })
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Start a return' })).toBeInTheDocument()
    expect(screen.queryByText('forbidden')).not.toBeInTheDocument()
  })

  it('serves an honest forgot-password placeholder, not a fake reset flow', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, ready: true } as never)
    renderAt('/forgot-password')

    expect(await screen.findByRole('heading', { name: 'Reset your password' })).toBeInTheDocument()
    expect(screen.getByText(/handled by your administrator/i)).toBeInTheDocument()
  })

  it('renders the login page link to forgot-password', async () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, ready: true } as never)
    renderAt('/login')

    expect(await screen.findByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
  })
})
