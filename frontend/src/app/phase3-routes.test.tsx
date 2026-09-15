import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { appRoutes } from './router'
import { useAuth } from '../auth/AuthContext'
import { listOrders, listProducts } from '../services/catalog'
import { ToastProvider } from '../components/feedback'
import type { Role } from '../lib/types'

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../services/catalog', () => ({ listOrders: vi.fn(), listProducts: vi.fn(), createOrder: vi.fn() }))

function authAs(role: Role | null) {
  vi.mocked(useAuth).mockReturnValue({
    user: role ? { id: 'u1', email: 'u@x.dev', fullName: 'User', role, enabled: true } : null,
    ready: true,
  } as never)
}

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  )
}

describe('Phase 3 order routes', () => {
  it('/orders/new renders for CUSTOMER', async () => {
    authAs('CUSTOMER')
    vi.mocked(listProducts).mockResolvedValue({ content: [], totalElements: 0, totalPages: 0, number: 0, size: 24 })
    renderAt('/orders/new')

    expect(await screen.findByRole('heading', { name: 'Place an order' }, { timeout: 10000 })).toBeInTheDocument()
  })

  it('/orders/new refuses WAREHOUSE_STAFF and ADMIN', async () => {
    for (const role of ['WAREHOUSE_STAFF', 'ADMIN'] as Role[]) {
      authAs(role)
      const { unmount } = renderAt('/orders/new')
      expect(await screen.findByText(/don't have access/i, {}, { timeout: 10000 })).toBeInTheDocument()
      unmount()
    }
  })

  it('/ops/orders renders for WAREHOUSE_STAFF and ADMIN', async () => {
    for (const role of ['WAREHOUSE_STAFF', 'ADMIN'] as Role[]) {
      authAs(role)
      vi.mocked(listOrders).mockResolvedValue({ content: [], totalElements: 0, totalPages: 0, number: 0, size: 12 })
      const { unmount } = renderAt('/ops/orders')
      expect(await screen.findByRole('heading', { name: 'Orders' }, { timeout: 10000 })).toBeInTheDocument()
      unmount()
    }
  })

  it('/ops/orders refuses CUSTOMER', async () => {
    authAs('CUSTOMER')
    renderAt('/ops/orders')

    expect(await screen.findByText(/don't have access/i, {}, { timeout: 10000 })).toBeInTheDocument()
  })

  it('keeps the existing customer return routes intact', async () => {
    authAs('CUSTOMER')
    vi.mocked(listOrders).mockResolvedValue({ content: [], totalElements: 0, totalPages: 0, number: 0, size: 20 })
    renderAt('/returns/new')

    expect(await screen.findByRole('heading', { name: 'Start a return' }, { timeout: 10000 })).toBeInTheDocument()
  })
})
