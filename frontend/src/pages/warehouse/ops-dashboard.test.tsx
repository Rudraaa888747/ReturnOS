import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import OpsDashboard from './OpsDashboard'
import { listReturns } from '../../services/returns'
import { listTasks } from '../../services/operations'
import { listAudit } from '../../services/admin'
import { useAuth } from '../../auth/AuthContext'
import type { Page, ReturnOrder } from '../../lib/types'

vi.mock('../../services/returns')
vi.mock('../../services/operations')
vi.mock('../../services/admin')
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }))

const staff = { id: 's1', email: 's@x.dev', fullName: 'Staff', role: 'WAREHOUSE_STAFF', enabled: true }

function makeReturn(id: string): ReturnOrder {
  return {
    id,
    returnNumber: `RET-${id}`,
    orderId: 'o1',
    customerId: 'c1',
    status: 'REQUESTED',
    requestedAt: '2026-09-01T10:00:00Z',
    approvedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    receivedAt: null,
    createdAt: '2026-09-01T10:00:00Z',
    items: [
      { id: `i-${id}`, orderItemId: 'oi1', productId: 'p1', sku: 'SKU-1', quantity: 1, reason: 'DEFECTIVE', description: null },
    ],
  }
}

function emptyPage<T>(): Page<T> {
  return { content: [], totalElements: 0, totalPages: 0, number: 0, size: 5 }
}

function renderDashboard(requested: ReturnOrder[] = []) {
  vi.mocked(useAuth).mockReturnValue({ user: staff, ready: true } as never)
  vi.mocked(listReturns).mockImplementation(async (params) => {
    if (params?.status === 'REQUESTED') {
      return { ...emptyPage<ReturnOrder>(), content: requested, totalElements: requested.length }
    }
    return emptyPage<ReturnOrder>()
  })
  vi.mocked(listTasks).mockResolvedValue(emptyPage())
  vi.mocked(listAudit).mockResolvedValue(emptyPage())
  return render(
    <MemoryRouter initialEntries={['/ops']}>
      <Routes>
        <Route path="/ops" element={<OpsDashboard />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('OpsDashboard attention panel', () => {
  it('keeps a stable body when the floor is clear', async () => {
    renderDashboard([])

    expect(await screen.findByTestId('attention-body')).toBeInTheDocument()
    expect(screen.getByText(/floor is clear/i)).toBeInTheDocument()
  })

  it('shows one row with a direct Review action in the same stable body', async () => {
    renderDashboard([makeReturn('r1')])

    const body = await screen.findByTestId('attention-body')
    expect(within(body).getByText('RET-r1')).toBeInTheDocument()
    const review = within(body).getByRole('link', { name: 'Review' })
    expect(review).toHaveAttribute('href', '/ops/returns/r1')
  })

  it('shows multiple rows without changing structure', async () => {
    renderDashboard([makeReturn('r1'), makeReturn('r2')])

    const body = await screen.findByTestId('attention-body')
    expect(within(body).getByText('RET-r1')).toBeInTheDocument()
    expect(within(body).getByText('RET-r2')).toBeInTheDocument()
  })
})
