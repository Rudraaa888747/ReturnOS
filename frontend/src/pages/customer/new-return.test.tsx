import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import NewReturn from './NewReturn'
import { listOrders } from '../../services/catalog'
import type { Order, Page } from '../../lib/types'
import { ToastProvider } from '../../components/feedback'

vi.mock('../../services/catalog')
vi.mock('../../services/returns', () => ({
  createReturn: vi.fn(),
}))

const delivered: Order = {
  id: 'o1',
  orderNumber: 'ORD-1',
  customerId: 'c1',
  status: 'DELIVERED',
  subtotal: 999,
  deliveredAt: '2026-08-20T10:00:00Z',
  createdAt: '2026-08-15T10:00:00Z',
  items: [
    {
      id: 'oi1',
      productId: 'p1',
      productName: 'Widget',
      sku: 'SKU-1',
      quantity: 1,
      unitPrice: 999,
      lineTotal: 999,
    },
  ],
}

function renderFlow() {
  return render(
    <MemoryRouter initialEntries={['/returns/new']}>
      <ToastProvider>
        <Routes>
          <Route path="/returns/new" element={<NewReturn />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('NewReturn', () => {
  it('walks order → items → review with validation at each step', async () => {
    const user = userEvent.setup()
    vi.mocked(listOrders).mockResolvedValue({
      content: [delivered],
      totalElements: 1,
      totalPages: 1,
      number: 0,
      size: 20,
    } satisfies Page<Order>)
    renderFlow()

    // Step 1: continue is blocked until an order is picked.
    expect(await screen.findByText('ORD-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to items' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: /ORD-1/ }))
    await user.click(screen.getByRole('button', { name: 'Continue to items' }))

    // Step 2: review is blocked until an item with a reason is picked.
    expect(await screen.findByText(/going back from/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review return' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Review return' })).toBeDisabled()
    const reason = screen.getByLabelText('Reason')
    await user.selectOptions(reason, 'DEFECTIVE')
    await user.click(screen.getByRole('button', { name: 'Review return' }))

    // Step 3: review shows the choice.
    const review = await screen.findByText('Review before submitting')
    expect(review).toBeInTheDocument()
    expect(within(review.closest('section')!).getByText(/Defective/)).toBeInTheDocument()
  })
})
