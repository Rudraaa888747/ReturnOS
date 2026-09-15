import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import WorkQueue from './WorkQueue'
import { listReturns } from '../../services/returns'
import type { Page, ReturnOrder } from '../../lib/types'

vi.mock('../../services/returns')

function makeReturn(id: string, number: string, sku: string): ReturnOrder {
  return {
    id,
    returnNumber: number,
    orderId: 'o1',
    customerId: 'c1',
    status: 'REQUESTED',
    requestedAt: '2026-09-01T10:00:00Z',
    approvedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    receivedAt: null,
    createdAt: '2026-09-01T10:00:00Z',
    items: [{ id: `i-${id}`, orderItemId: 'oi1', productId: 'p1', sku, quantity: 1, reason: 'DEFECTIVE', description: null }],
  }
}

function pageOf(content: ReturnOrder[], totalElements = 25, totalPages = 3): Page<ReturnOrder> {
  return { content, totalElements, totalPages, number: 0, size: 12 }
}

function renderQueue() {
  return render(
    <MemoryRouter initialEntries={['/ops/returns']}>
      <Routes>
        <Route path="/ops/returns" element={<WorkQueue />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('WorkQueue search', () => {
  it('hides server pagination while searching and explains the scope', async () => {
    const user = userEvent.setup()
    vi.mocked(listReturns).mockResolvedValue(pageOf([makeReturn('r1', 'RET-AAA', 'SKU-1'), makeReturn('r2', 'RET-BBB', 'SKU-2')]))
    renderQueue()

    expect(await screen.findByText('RET-AAA')).toBeInTheDocument()
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/search this page/i), 'RET-AAA')

    expect(screen.queryByText('RET-BBB')).not.toBeInTheDocument()
    expect(screen.queryByText(/Page 1 of 3/)).not.toBeInTheDocument()
    expect(screen.getByText(/Showing 1 of 2 results on this page/)).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Return work queue' })
    expect(within(table).getByText('RET-AAA')).toBeInTheDocument()
  })

  it('restores pagination after clearing the search', async () => {
    const user = userEvent.setup()
    vi.mocked(listReturns).mockResolvedValue(pageOf([makeReturn('r1', 'RET-AAA', 'SKU-1')]))
    renderQueue()

    expect(await screen.findByText('RET-AAA')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/search this page/i), 'zzz-no-match')
    expect(await screen.findByText('Nothing matches')).toBeInTheDocument()
    expect(screen.queryByText(/Page 1 of/)).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText(/search this page/i))
    expect(await screen.findByText('RET-AAA')).toBeInTheDocument()
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument()
  })
})
