import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, api, friendlyMessage, getToken } from './api'
import type { Cart, CartLine } from './api'
import { useOptionalSession } from './session'

/**
 * Shared customer cart.
 *
 * The server owns the cart: every mutation posts to the API and the response
 * becomes the new state, so quantities, stock limits, and the subtotal are
 * never computed in the browser. One provider means the store grid, the cart
 * page, the nav badge, and checkout all read the same numbers.
 */
interface CartState {
  cart: Cart;
  ready: boolean;
  error: string | null;
  /** Product ID currently being written, for per-row busy states. */
  pendingId: string | null;
  quantityOf: (productId: string) => number;
  lineOf: (productId: string) => CartLine | undefined;
  add: (productId: string, quantity?: number) => Promise<void>;
  setQuantity: (productId: string, quantity: number) => Promise<void>;
  remove: (productId: string) => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
}

const EMPTY_CART: Cart = { items: [], subtotalPaise: 0, totalQuantity: 0 }

const CartContext = createContext<CartState | null>(null)

/** Stock rejections read better than the generic API message. */
function cartErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK') {
    return 'Only limited stock is available for this item.'
  }
  return friendlyMessage(err)
}

export function CartProvider({ children }: { children: ReactNode }) {
  // The cart is a customer concern, but this provider wraps the whole app so
  // any page can read it. Warehouse and admin sessions have no cart and are
  // refused by the customer API, so asking would mean a 403 on every page
  // load. The session tells us who is signed in; when there is no session
  // provider at all (unit tests) the token alone decides, as before.
  const session = useOptionalSession()
  const role = session?.user?.role
  const sessionKnown = session === null || session.ready
  const isCustomer = session === null || role === 'CUSTOMER'

  const [cart, setCart] = useState<Cart>(EMPTY_CART)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!getToken() || !isCustomer) {
      setCart(EMPTY_CART)
      setReady(true)
      return
    }
    try {
      const data = await api<Cart>('/cart')
      if (mounted.current) setCart(data)
    } catch (err) {
      if (mounted.current) setError(friendlyMessage(err))
    } finally {
      if (mounted.current) setReady(true)
    }
  }, [isCustomer])

  useEffect(() => {
    // Wait until the session has resolved, so a customer is not skipped just
    // because their role had not loaded yet on first paint.
    if (!sessionKnown) return
    void refresh()
  }, [refresh, sessionKnown])

  /** Run one cart write, adopting the server's cart as the new state. */
  const mutate = useCallback(async (productId: string, run: () => Promise<Cart>) => {
    setPendingId(productId)
    setError(null)
    try {
      const data = await run()
      if (mounted.current) setCart(data)
    } catch (err) {
      if (mounted.current) setError(cartErrorMessage(err))
    } finally {
      if (mounted.current) setPendingId(null)
    }
  }, [])

  const add = useCallback(
    async (productId: string, quantity = 1) => {
      await mutate(productId, () => api<Cart>('/cart', { method: 'POST', body: { productId, quantity } }))
    },
    [mutate],
  )

  const setQuantity = useCallback(
    async (productId: string, quantity: number) => {
      // The API treats a zero quantity as removal, so one call covers both.
      await mutate(productId, () => api<Cart>(`/cart/${productId}`, { method: 'PATCH', body: { quantity } }))
    },
    [mutate],
  )

  const remove = useCallback(
    async (productId: string) => {
      await mutate(productId, () => api<Cart>(`/cart/${productId}`, { method: 'DELETE' }))
    },
    [mutate],
  )

  const value = useMemo<CartState>(() => {
    const byProduct = new Map(cart.items.map((line) => [line.productId, line]))
    return {
      cart,
      ready,
      error,
      pendingId,
      quantityOf: (productId: string) => byProduct.get(productId)?.quantity ?? 0,
      lineOf: (productId: string) => byProduct.get(productId),
      add,
      setQuantity,
      remove,
      refresh,
      clearError: () => setError(null),
    }
  }, [cart, ready, error, pendingId, add, setQuantity, remove, refresh])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartState {
  const context = useContext(CartContext)
  if (context === null) {
    throw new Error('useCart must be used inside a CartProvider')
  }
  return context
}
