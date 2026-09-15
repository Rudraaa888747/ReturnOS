import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import NewReturn from './NewReturn'
import { listOrders } from '../../services/catalog'
import { createReturn } from '../../services/returns'
import type { Order, Page } from '../../lib/types'
import { ToastProvider } from '../../components/feedback'
import { useAuth } from '../../auth/AuthContext'

vi.mock('../../services/catalog')
vi.mock('../../services/returns', () => ({
  createReturn: vi.fn(),
}))
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }))

const customer = { id: 'c1', email: 'c@x.dev', fullName: 'Customer', role: 'CUSTOMER', enabled: true }
const staff = { id: 's1', email: 's@x.dev', fullName: 'Staff', role: 'WAREHOUSE_STAFF', enabled: true }

function authAs(role: 'CUSTOMER' | 'WAREHOUSE_STAFF') {
  vi.mocked(useAuth).mockReturnValue({
    user: role === 'CUSTOMER' ? customer : staff,
    ready: true,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
  } as never)
}

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
    authAs('CUSTOMER')
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

  it('lets completed steps take you back, but never forward', async () => {
    const user = userEvent.setup()
    authAs('CUSTOMER')
    vi.mocked(listOrders).mockResolvedValue({
      content: [delivered],
      totalElements: 1,
      totalPages: 1,
      number: 0,
      size: 20,
    } satisfies Page<Order>)
    renderFlow()

    expect(await screen.findByText('ORD-1')).toBeInTheDocument()
    // Future steps are plain text, not buttons.
    expect(screen.queryByRole('button', { name: /back to step/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /ORD-1/ }))
    await user.click(screen.getByRole('button', { name: 'Continue to items' }))
    expect(await screen.findByText(/going back from/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /back to step 1/i }))
    expect(await screen.findByText('ORD-1')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /ORD-1/ })).toBeChecked()
  })

  it('loads more orders without duplicating or losing the delivered filter', async () => {
    const user = userEvent.setup()
    authAs('CUSTOMER')
    const second: Order = { ...delivered, id: 'o2', orderNumber: 'ORD-2' }
    const placed: Order = { ...delivered, id: 'o3', orderNumber: 'ORD-3', status: 'PLACED' }
    vi.mocked(listOrders)
      .mockResolvedValueOnce({ content: [delivered], totalElements: 3, totalPages: 2, number: 0, size: 20 })
      .mockResolvedValueOnce({ content: [second, placed], totalElements: 3, totalPages: 2, number: 1, size: 20 })
    renderFlow()

    expect(await screen.findByText('ORD-1')).toBeInTheDocument()
    expect(screen.queryByText('ORD-2')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /load more orders \(1 of 3 shown\)/i }))
    expect(await screen.findByText('ORD-2')).toBeInTheDocument()
    // Placed orders stay ineligible even after merging pages.
    expect(screen.queryByText('ORD-3')).not.toBeInTheDocument()
    expect(await screen.findByText(/showing all 3 orders/i)).toBeInTheDocument()
  })

  it('submits only once even when the button is hammered', async () => {
    const user = userEvent.setup()
    authAs('CUSTOMER')
    vi.mocked(listOrders).mockResolvedValue({
      content: [delivered],
      totalElements: 1,
      totalPages: 1,
      number: 0,
      size: 20,
    } satisfies Page<Order>)
    let resolveCreate!: (value: { id: string; returnNumber: string }) => void
    vi.mocked(createReturn).mockImplementation(
      () => new Promise((resolve) => (resolveCreate = resolve as never)),
    )
    render(
      <MemoryRouter initialEntries={['/returns/new']}>
        <ToastProvider>
          <Routes>
            <Route path="/returns/new" element={<NewReturn />} />
            <Route path="/returns/:id" element={<p>return detail</p>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('ORD-1')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /ORD-1/ }))
    await user.click(screen.getByRole('button', { name: 'Continue to items' }))
    await user.click(screen.getByRole('checkbox'))
    await user.selectOptions(screen.getByLabelText('Reason'), 'DEFECTIVE')
    await user.click(screen.getByRole('button', { name: 'Review return' }))
    expect(await screen.findByText('Review before submitting')).toBeInTheDocument()

    const submit = screen.getByRole('button', { name: 'Submit return' })
    await user.click(submit)
    await user.click(submit)
    expect(createReturn).toHaveBeenCalledTimes(1)

    resolveCreate({ id: 'r1', returnNumber: 'RET-1' })
    expect(await screen.findByText('return detail')).toBeInTheDocument()
  })

  it('sends warehouse staff to the operations detail after submit', async () => {
    const user = userEvent.setup()
    authAs('WAREHOUSE_STAFF')
    vi.mocked(listOrders).mockResolvedValue({
      content: [delivered],
      totalElements: 1,
      totalPages: 1,
      number: 0,
      size: 20,
    } satisfies Page<Order>)
    vi.mocked(createReturn).mockResolvedValue({ id: 'r9', returnNumber: 'RET-9' } as never)
    render(
      <MemoryRouter initialEntries={['/returns/new']}>
        <ToastProvider>
          <Routes>
            <Route path="/returns/new" element={<NewReturn />} />
            <Route path="/ops/returns/:id" element={<p>ops detail</p>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('ORD-1')).toBeInTheDocument()
    expect(screen.getByText(/attaches to the order/)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /ORD-1/ }))
    await user.click(screen.getByRole('button', { name: 'Continue to items' }))
    await user.click(screen.getByRole('checkbox'))
    await user.selectOptions(screen.getByLabelText('Reason'), 'DAMAGED')
    await user.click(screen.getByRole('button', { name: 'Review return' }))
    expect(await screen.findByText('Review before submitting')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit return' }))
    expect(await screen.findByText('ops detail')).toBeInTheDocument()
  })
})
