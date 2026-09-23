import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setToken } from './api'
import { CartProvider, useCart } from './cart'
import { SessionProvider } from './session'
import type { Cart } from './api'

function cartBody(quantity: number): Cart {
  return quantity === 0
    ? { items: [], subtotalPaise: 0, totalQuantity: 0 }
    : {
        items: [
          {
            productId: 'p-tee',
            sku: 'TEE-CORE-WHT-M',
            name: 'Essential Cotton Tee',
            pricePaise: 129900,
            imageUrl: '/products/tee.svg',
            stock: 100,
            quantity,
            lineTotalPaise: 129900 * quantity,
          },
        ],
        subtotalPaise: 129900 * quantity,
        totalQuantity: quantity,
      }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** Minimal consumer that exercises the provider's public surface. */
function Probe() {
  const { cart, ready, error, quantityOf, add, setQuantity } = useCart()
  if (!ready) return <p>loading</p>
  return (
    <div>
      <span data-testid="count">{cart.totalQuantity}</span>
      <span data-testid="subtotal">{cart.subtotalPaise}</span>
      <span data-testid="tee">{quantityOf('p-tee')}</span>
      <span data-testid="error">{error ?? ''}</span>
      <button type="button" onClick={() => void add('p-tee', 1)}>
        add
      </button>
      <button type="button" onClick={() => void setQuantity('p-tee', 2)}>
        set two
      </button>
    </div>
  )
}

describe('cart provider', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    setToken('test-token')
  })

  it('loads the cart from the server on mount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, cartBody(3))),
    )
    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('3'))
    expect(screen.getByTestId('tee')).toHaveTextContent('3')
  })

  it('adopts the server cart after a write rather than counting locally', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) =>
      // The POST response is the authority: it reports 5, not the 0 + 1 a
      // client-side tally would produce.
      jsonResponse(init?.method === 'POST' ? 201 : 200, cartBody(init?.method === 'POST' ? 5 : 0)),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'))

    await userEvent.click(screen.getByRole('button', { name: 'add' }))
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('5'))
    expect(screen.getByTestId('subtotal')).toHaveTextContent(String(129900 * 5))
  })

  it('surfaces a stock rejection instead of changing the quantity', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return jsonResponse(409, { code: 'INSUFFICIENT_STOCK', message: 'Not enough stock' })
      }
      return jsonResponse(200, cartBody(1))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'))

    await userEvent.click(screen.getByRole('button', { name: 'set two' }))
    await waitFor(() =>
      expect(screen.getByTestId('error')).toHaveTextContent('Only limited stock is available for this item.'),
    )
    // The rejected write left the quantity untouched.
    expect(screen.getByTestId('tee')).toHaveTextContent('1')
  })

  it('stays empty and never calls the API when logged out', async () => {
    setToken(null)
    const fetchMock = vi.fn(async () => jsonResponse(200, cartBody(9)))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /**
   * The provider wraps the whole app, so it also mounts for warehouse and
   * admin sessions. Those roles have no cart and the customer API refuses
   * them, so asking would mean a 403 on every page they open.
   */
  it('does not request a cart for a non-customer session', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (String(input).includes('/auth/me')) {
        return jsonResponse(200, { user: { id: 'u1', email: 'a@b.c', fullName: 'Ops', role: 'WAREHOUSE' } })
      }
      return jsonResponse(200, cartBody(4))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <SessionProvider>
        <CartProvider>
          <Probe />
        </CartProvider>
      </SessionProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'))

    const cartCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/cart'))
    expect(cartCalls, 'a warehouse session must not fetch the customer cart').toHaveLength(0)
  })

  it('still requests a cart once the session resolves as a customer', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (String(input).includes('/auth/me')) {
        return jsonResponse(200, { user: { id: 'u2', email: 'c@b.c', fullName: 'Buyer', role: 'CUSTOMER' } })
      }
      return jsonResponse(200, cartBody(4))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <SessionProvider>
        <CartProvider>
          <Probe />
        </CartProvider>
      </SessionProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('4'))
  })
})
