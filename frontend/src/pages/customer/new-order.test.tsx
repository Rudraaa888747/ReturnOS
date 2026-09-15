import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import NewOrder from './NewOrder'
import { createOrder, listProducts } from '../../services/catalog'
import type { Page, Product } from '../../lib/types'
import { ToastProvider } from '../../components/feedback'
import { money } from '../../lib/format'

vi.mock('../../services/catalog', () => ({
  listProducts: vi.fn(),
  createOrder: vi.fn(),
}))

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    sku: 'SKU-1',
    name: 'Widget',
    category: 'Audio',
    description: 'A fine widget',
    price: 4597,
    active: true,
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z',
    ...overrides,
  }
}

function pageOf(content: Product[]): Page<Product> {
  return { content, totalElements: content.length, totalPages: 1, number: 0, size: 24 }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/orders/new']}>
      <ToastProvider>
        <Routes>
          <Route path="/orders/new" element={<NewOrder />} />
          <Route path="/returns" element={<p>my returns</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('NewOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('disables Place order when the cart is empty', async () => {
    vi.mocked(listProducts).mockResolvedValue(pageOf([product()]))
    renderPage()

    expect(await screen.findByText('Widget')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Place order' })).toBeDisabled()
  })

  it('adds a product and shows line + order totals in INR', async () => {
    const user = userEvent.setup()
    vi.mocked(listProducts).mockResolvedValue(pageOf([product()]))
    renderPage()

    expect(await screen.findByText('Widget')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByRole('button', { name: 'Place order' })).toBeEnabled()
    expect(screen.getAllByText(money(4597)).length).toBeGreaterThan(0)
  })

  it('changes quantity with the stepper', async () => {
    const user = userEvent.setup()
    vi.mocked(listProducts).mockResolvedValue(pageOf([product()]))
    renderPage()

    expect(await screen.findByText('Widget')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: /add one more/i }))

    expect(screen.getByRole('status', { name: 'Quantity: 2' })).toBeInTheDocument()
    expect(screen.getAllByText(money(4597 * 2)).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /remove one/i }))
    expect(screen.getByRole('status', { name: 'Quantity: 1' })).toBeInTheDocument()
  })

  it('blocks invalid quantity (removing the last unit empties the line)', async () => {
    const user = userEvent.setup()
    vi.mocked(listProducts).mockResolvedValue(pageOf([product()]))
    renderPage()

    expect(await screen.findByText('Widget')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: /remove one/i }))

    // Back to unselected: Add returns, Place order disables again.
    expect(await screen.findByRole('button', { name: 'Add' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Place order' })).toBeDisabled()
  })

  it('supports multiple different products with a combined INR total', async () => {
    const user = userEvent.setup()
    const second = product({ id: 'p2', sku: 'SKU-2', name: 'Gadget', price: 999 })
    vi.mocked(listProducts).mockResolvedValue(pageOf([product(), second]))
    renderPage()

    expect(await screen.findByText('Widget')).toBeInTheDocument()
    expect(screen.getByText('Gadget')).toBeInTheDocument()
    let adds = screen.getAllByRole('button', { name: 'Add' })
    await user.click(adds[0])
    adds = screen.getAllByRole('button', { name: 'Add' })
    await user.click(adds[0])

    expect(screen.getByText(money(4597 + 999))).toBeInTheDocument()
    expect(vi.mocked(listProducts)).toHaveBeenCalled()
  })

  it('will not sell an unavailable product', async () => {
    vi.mocked(listProducts).mockResolvedValue(pageOf([product({ active: false })]))
    renderPage()

    expect(await screen.findByText('Unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Place order' })).toBeDisabled()
  })

  it('calls createOrder with product + quantity on success', async () => {
    const user = userEvent.setup()
    vi.mocked(listProducts).mockResolvedValue(pageOf([product()]))
    vi.mocked(createOrder).mockResolvedValue({ id: 'o1', orderNumber: 'ORD-1' } as never)
    renderPage()

    expect(await screen.findByText('Widget')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'Place order' }))

    expect(createOrder).toHaveBeenCalledWith([{ productId: 'p1', quantity: 1 }])
  })

  it('shows success feedback and navigates to /returns', async () => {
    const user = userEvent.setup()
    vi.mocked(listProducts).mockResolvedValue(pageOf([product()]))
    vi.mocked(createOrder).mockResolvedValue({ id: 'o1', orderNumber: 'ORD-1' } as never)
    renderPage()

    expect(await screen.findByText('Widget')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'Place order' }))

    expect(await screen.findByText('my returns')).toBeInTheDocument()
    expect(await screen.findByText(/your order has been placed/i)).toBeInTheDocument()
    expect(screen.getByText(/once it's delivered/i)).toBeInTheDocument()
  })

  it('prevents double submission while the request is in flight', async () => {
    const user = userEvent.setup()
    vi.mocked(listProducts).mockResolvedValue(pageOf([product()]))
    let resolveOrder!: (v: unknown) => void
    vi.mocked(createOrder).mockImplementation(() => new Promise((r) => (resolveOrder = r as never)))
    renderPage()

    expect(await screen.findByText('Widget')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    const place = screen.getByRole('button', { name: /place order|placing order/i })
    await user.click(place)
    await user.click(screen.getByRole('button', { name: /placing order/i }))
    expect(createOrder).toHaveBeenCalledTimes(1)

    resolveOrder({ id: 'o1', orderNumber: 'ORD-1' })
    expect(await screen.findByText('my returns')).toBeInTheDocument()
  })

  it('keeps the cart and shows an error when createOrder fails', async () => {
    const user = userEvent.setup()
    vi.mocked(listProducts).mockResolvedValue(pageOf([product()]))
    vi.mocked(createOrder).mockRejectedValue(new Error('Order boom'))
    renderPage()

    expect(await screen.findByText('Widget')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'Place order' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Order boom')
    // Cart preserved so the customer can retry.
    expect(screen.getByRole('status', { name: 'Quantity: 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Place order' })).toBeEnabled()
  })

  it('formats every price in INR, never $/£/€', async () => {
    vi.mocked(listProducts).mockResolvedValue(pageOf([product({ price: 12499 })]))
    renderPage()

    expect(await screen.findByText('₹12,499')).toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })
})
