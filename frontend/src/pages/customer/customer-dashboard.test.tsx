import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import CustomerDashboard from './CustomerDashboard'
import { listReturns } from '../../services/returns'
import { useAuth } from '../../auth/AuthContext'
import type { Page, ReturnOrder, ReturnStatus } from '../../lib/types'

vi.mock('../../services/returns')
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }))

const customer = { id: 'c1', email: 'c@x.dev', fullName: 'Customer', role: 'CUSTOMER', enabled: true }

function makeReturn(id: string, status: ReturnStatus): ReturnOrder {
  return {
    id,
    returnNumber: `RET-${id}`,
    orderId: 'o1',
    customerId: 'c1',
    status,
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

function renderDashboard(content: ReturnOrder[]) {
  vi.mocked(useAuth).mockReturnValue({ user: customer, ready: true } as never)
  vi.mocked(listReturns).mockResolvedValue({ content, totalElements: content.length, totalPages: 1, number: 0, size: 20 } satisfies Page<ReturnOrder>)
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<CustomerDashboard />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CustomerDashboard attention panel', () => {
  it('shows the empty state when there are no returns at all', async () => {
    renderDashboard([])

    expect(await screen.findByText(/your return history will appear here/i)).toBeInTheDocument()
    expect(screen.queryByTestId('attention-body')).not.toBeInTheDocument()
  })

  it('keeps a stable body with zero actionable items', async () => {
    renderDashboard([makeReturn('r0', 'IN_TRANSIT')])

    expect(await screen.findByTestId('attention-body')).toBeInTheDocument()
    expect(screen.getByText(/nothing needs you right now/i)).toBeInTheDocument()
  })

  it('lists one actionable return in the same stable body', async () => {
    renderDashboard([makeReturn('r1', 'APPROVED')])

    const body = await screen.findByTestId('attention-body')
    expect(within(body).getByText('RET-r1')).toBeInTheDocument()
    expect(within(body).getByText(/ship your item/i)).toBeInTheDocument()
  })

  it('lists multiple actionable returns without changing structure', async () => {
    renderDashboard([makeReturn('r1', 'APPROVED'), makeReturn('r2', 'REJECTED')])

    const body = await screen.findByTestId('attention-body')
    const rows = within(body).getAllByRole('link')
    expect(rows).toHaveLength(2)
  })
})
