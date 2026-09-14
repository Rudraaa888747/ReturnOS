import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import CustomerReturns from './CustomerReturns'
import { listReturns } from '../../services/returns'
import type { Page, ReturnOrder } from '../../lib/types'

vi.mock('../../services/returns')

const returns: ReturnOrder[] = [
  {
    id: 'r1',
    returnNumber: 'RET-AAA',
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
      {
        id: 'i1',
        orderItemId: 'oi1',
        productId: 'p1',
        sku: 'SKU-1',
        quantity: 1,
        reason: 'DEFECTIVE',
        description: null,
      },
    ],
  },
]

function pageOf(content: ReturnOrder[]): Page<ReturnOrder> {
  return { content, totalElements: content.length, totalPages: 1, number: 0, size: 10 }
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/returns']}>
      <Routes>
        <Route path="/returns" element={<CustomerReturns />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CustomerReturns', () => {
  it('lists returns with status and items', async () => {
    vi.mocked(listReturns).mockResolvedValue(pageOf(returns))
    renderList()

    expect(await screen.findByText('RET-AAA')).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Your returns' })
    expect(within(table).getByRole('columnheader', { name: 'Requested' })).toBeInTheDocument()
    expect(within(table).getByText('Requested', { selector: 'span' })).toBeInTheDocument()
    expect(within(table).getByText(/1 × SKU-1/)).toBeInTheDocument()
  })

  it('shows an empty state when there is nothing to show', async () => {
    vi.mocked(listReturns).mockResolvedValue(pageOf([]))
    renderList()

    expect(await screen.findByText('No returns yet')).toBeInTheDocument()
  })

  it('shows a retry action when loading fails', async () => {
    const user = userEvent.setup()
    vi.mocked(listReturns)
      .mockRejectedValueOnce(new Error('Could not reach the ReturnOS service.'))
      .mockResolvedValueOnce(pageOf(returns))
    renderList()

    expect(await screen.findByText("You're offline")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('RET-AAA')).toBeInTheDocument()
  })
})
