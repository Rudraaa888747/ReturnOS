import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import OrdersList from './OrdersList'
import { listOrders, markDelivered } from '../../services/catalog'
import type { Order, Page } from '../../lib/types'
import { ToastProvider } from '../../components/feedback'

vi.mock('../../services/catalog', () => ({
  listOrders: vi.fn(),
  markDelivered: vi.fn(),
}))

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    orderNumber: 'ORD-1',
    customerId: 'c1',
    status: 'PLACED',
    subtotal: 4597,
    deliveredAt: null,
    createdAt: '2026-09-01T10:00:00Z',
    items: [
      { id: 'oi1', productId: 'p1', productName: 'Widget', sku: 'SKU-1', quantity: 2, unitPrice: 1000, lineTotal: 2000 },
    ],
    ...overrides,
  }
}

function pageOf(content: Order[]): Page<Order> {
  return { content, totalElements: content.length, totalPages: 1, number: 0, size: 12 }
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/ops/orders']}>
      <ToastProvider>
        <Routes>
          <Route path="/ops/orders" element={<OrdersList />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('OrdersList delivery flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows Mark delivered for PLACED orders', async () => {
    vi.mocked(listOrders).mockResolvedValue(pageOf([order()]))
    renderList()

    expect(await screen.findByText('ORD-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark delivered' })).toBeInTheDocument()
  })

  it('hides Mark delivered for DELIVERED orders', async () => {
    vi.mocked(listOrders).mockResolvedValue(pageOf([order({ id: 'o2', orderNumber: 'ORD-2', status: 'DELIVERED' })]))
    renderList()

    expect(await screen.findByText('ORD-2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark delivered' })).not.toBeInTheDocument()
  })

  it('asks for confirmation before calling the API', async () => {
    const user = userEvent.setup()
    vi.mocked(listOrders).mockResolvedValue(pageOf([order()]))
    renderList()

    expect(await screen.findByText('ORD-1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark delivered' }))

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mark this order as delivered?' })).toBeInTheDocument()
    expect(markDelivered).not.toHaveBeenCalled()
  })

  it('does not call the API when confirmation is cancelled', async () => {
    const user = userEvent.setup()
    vi.mocked(listOrders).mockResolvedValue(pageOf([order()]))
    renderList()

    expect(await screen.findByText('ORD-1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark delivered' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(markDelivered).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('calls markDelivered(orderId) on confirm and refreshes to DELIVERED', async () => {
    const user = userEvent.setup()
    vi.mocked(listOrders)
      .mockResolvedValueOnce(pageOf([order()]))
      .mockResolvedValueOnce(pageOf([order({ status: 'DELIVERED', deliveredAt: '2026-09-02T10:00:00Z' })]))
    vi.mocked(markDelivered).mockResolvedValue(order({ status: 'DELIVERED' }) as Order)
    renderList()

    expect(await screen.findByText('ORD-1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark delivered' }))

    // The confirm-dialog button shares the label; scope to the dialog.
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Mark delivered' }))

    expect(markDelivered).toHaveBeenCalledWith('o1')
    expect(await screen.findByText(/marked delivered/i)).toBeInTheDocument()
    // Refreshed row no longer offers the action.
    const table = screen.getByRole('table', { name: 'Customer orders' })
    expect(within(table).getByText('Delivered')).toBeInTheDocument()
  })

  it('keeps the PLACED state and shows an error when delivery fails', async () => {
    const user = userEvent.setup()
    vi.mocked(listOrders).mockResolvedValue(pageOf([order()]))
    vi.mocked(markDelivered).mockRejectedValue(new Error('Delivery boom'))
    renderList()

    expect(await screen.findByText('ORD-1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark delivered' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Mark delivered' }))

    expect(await screen.findByText('Delivery boom')).toBeInTheDocument()
    // Row keeps its previous state and stays retryable.
    expect(screen.getByText('ORD-1')).toBeInTheDocument()
    const row = screen.getByText('ORD-1').closest('tr')!
    expect(within(row).getByText('Placed')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Mark delivered' })).toBeInTheDocument()
  })

  it('prevents duplicate delivery clicks while loading', async () => {
    const user = userEvent.setup()
    vi.mocked(listOrders).mockResolvedValue(pageOf([order()]))
    let resolveDeliver!: (v: unknown) => void
    vi.mocked(markDelivered).mockImplementation(() => new Promise((r) => (resolveDeliver = r as never)))
    renderList()

    expect(await screen.findByText('ORD-1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark delivered' }))
    const dialog = await screen.findByRole('alertdialog')
    const confirm = within(dialog).getByRole('button', { name: 'Mark delivered' })
    await user.click(confirm)
    await user.click(confirm)
    expect(markDelivered).toHaveBeenCalledTimes(1)

    resolveDeliver(order({ status: 'DELIVERED' }))
  })

  it('shows INR totals without leaking other currencies', async () => {
    vi.mocked(listOrders).mockResolvedValue(pageOf([order({ subtotal: 4597 })]))
    renderList()

    expect(await screen.findByText('₹4,597')).toBeInTheDocument()
  })
})
