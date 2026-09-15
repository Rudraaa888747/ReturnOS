import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAsync } from '../../hooks/useAsync'
import { errorMessage } from '../../lib/api'
import { money } from '../../lib/format'
import { createOrder, listProducts } from '../../services/catalog'
import type { Product } from '../../lib/types'
import {
  Button,
  EmptyState,
  FormError,
  InlineSpinner,
  LoadError,
  PageHead,
  Panel,
  Skeleton,
} from '../../components/ui'
import { useToast } from '../../components/feedback'
import styles from './NewOrder.module.css'

interface CartLine {
  product: Product
  quantity: number
}

const PAGE_SIZE = 24

export default function NewOrder() {
  const navigate = useNavigate()
  const notify = useToast()
  const [cart, setCart] = useState<CartLine[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)

  const first = useAsync(() => listProducts({ page: 0, size: PAGE_SIZE }))
  const [extra, setExtra] = useState<Product[]>([])
  const [nextPage, setNextPage] = useState(1)
  const [moreBusy, setMoreBusy] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  const totalPages = first.data?.totalPages ?? 1
  const totalElements = first.data?.totalElements ?? 0

  const products = useMemo(() => {
    const seen = new Set<string>()
    const merged: Product[] = []
    for (const p of [...(first.data?.content ?? []), ...extra]) {
      if (!seen.has(p.id)) {
        seen.add(p.id)
        merged.push(p)
      }
    }
    return merged
  }, [first.data, extra])

  const hasMore = nextPage < totalPages

  const loadMore = async () => {
    setMoreBusy(true)
    setMoreError(null)
    try {
      const page = await listProducts({ page: nextPage, size: PAGE_SIZE })
      setExtra((prev) => [...prev, ...page.content])
      setNextPage((n) => n + 1)
    } catch (err) {
      setMoreError(errorMessage(err))
    } finally {
      setMoreBusy(false)
    }
  }

  const setQty = (product: Product, quantity: number) => {
    if (!product.active) return
    const qty = Math.max(0, Math.floor(quantity))
    setCart((prev) => {
      const rest = prev.filter((l) => l.product.id !== product.id)
      return qty <= 0 ? rest : [...rest, { product, quantity: qty }]
    })
  }

  const qtyOf = (id: string) => cart.find((l) => l.product.id === id)?.quantity ?? 0
  const total = cart.reduce((sum, l) => sum + l.product.price * l.quantity, 0)
  const valid = cart.length > 0 && cart.every((l) => l.quantity >= 1 && l.product.active)

  const submit = async () => {
    if (submitting.current) return
    if (!valid) {
      setFormError('Add at least one available product to place the order.')
      return
    }
    submitting.current = true
    setFormError(null)
    setBusy(true)
    try {
      await createOrder(cart.map((l) => ({ productId: l.product.id, quantity: l.quantity })))
      notify("Your order has been placed. Once it's delivered, you'll be able to start a return for it.")
      navigate('/returns', { replace: true })
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setBusy(false)
      submitting.current = false
    }
  }

  return (
    <>
      <PageHead
        title="Place an order"
        intro="Browse the catalog. Once your order is delivered, you'll be able to start a return for it."
      />
      {first.loading && (
        <div className={styles.layout}>
          <div>
            <Skeleton height={120} />
            <div style={{ height: 'var(--sp-3)' }} />
            <Skeleton height={120} />
          </div>
          <Skeleton height={220} />
        </div>
      )}
      {first.error && <LoadError error={first.error} onRetry={first.reload} />}
      {first.data && (
        <div className={styles.layout}>
          <section aria-label="Product catalog">
            {products.length === 0 ? (
              <EmptyState
                title="Catalog is empty"
                body="No products are available right now. Check back later."
              />
            ) : (
              <>
                <ul className={styles.grid}>
                  {products.map((p) => {
                    const qty = qtyOf(p.id)
                    return (
                      <li key={p.id} className={`${styles.card} ${qty > 0 ? styles.selected : ''}`}>
                        <div className={styles.cardTop}>
                          <strong>{p.name}</strong>
                          {p.active ? null : <span className={styles.unavailable}>Unavailable</span>}
                        </div>
                        <p className="meta data">
                          {p.sku} · {p.category}
                        </p>
                        {p.description && <p className={styles.desc}>{p.description}</p>}
                        <p className={styles.price} aria-label={`Price ${money(p.price)}`}>
                          {money(p.price)}
                        </p>
                        {p.active ? (
                          qty === 0 ? (
                            <Button size="sm" onClick={() => setQty(p, 1)}>
                              Add
                            </Button>
                          ) : (
                            <span className={styles.stepper}>
                              <Button
                                size="sm"
                                aria-label={`Remove one ${p.name}`}
                                onClick={() => setQty(p, qty - 1)}
                              >
                                −
                              </Button>
                              <span role="status" aria-label={`Quantity: ${qty}`} className="data">
                                {qty}
                              </span>
                              <Button size="sm" aria-label={`Add one more ${p.name}`} onClick={() => setQty(p, qty + 1)}>
                                +
                              </Button>
                            </span>
                          )
                        ) : (
                          <p className="meta">Not orderable right now.</p>
                        )}
                      </li>
                    )
                  })}
                </ul>
                {hasMore ? (
                  <div style={{ marginTop: 'var(--sp-4)' }}>
                    <Button size="sm" disabled={moreBusy} onClick={() => void loadMore()}>
                      {moreBusy ? (
                        <InlineSpinner label="Loading more products…" />
                      ) : (
                        <>Load more products ({products.length} of {totalElements} shown)</>
                      )}
                    </Button>
                    {moreError && (
                      <p role="alert" className="meta" style={{ color: 'var(--bad)', marginTop: 'var(--sp-2)' }}>
                        {moreError}
                      </p>
                    )}
                  </div>
                ) : (
                  totalPages > 1 && (
                    <p className="meta" style={{ marginTop: 'var(--sp-4)' }}>
                      Showing all {products.length} products.
                    </p>
                  )
                )}
              </>
            )}
          </section>
          <Panel title="Your order" sub={cart.length === 0 ? 'Nothing selected yet.' : undefined}>
            {cart.length === 0 ? (
              <p className="meta">Pick products from the catalog — your cart appears here.</p>
            ) : (
              <dl style={{ margin: 0 }}>
                {cart.map((l) => (
                  <div className={styles.line} key={l.product.id}>
                    <dt>
                      {l.quantity} × {l.product.name}
                      <span className="meta"> — {money(l.product.price)} each</span>
                    </dt>
                    <dd className="data">{money(l.product.price * l.quantity)}</dd>
                  </div>
                ))}
                <div className={styles.total}>
                  <dt>Order total</dt>
                  <dd className="data">{money(total)}</dd>
                </div>
              </dl>
            )}
            <FormError message={formError} />
            <div style={{ marginTop: 'var(--sp-4)' }}>
              <Button variant="primary" disabled={!valid || busy} onClick={() => void submit()}>
                {busy ? <InlineSpinner label="Placing order…" /> : 'Place order'}
              </Button>
            </div>
          </Panel>
        </div>
      )}
      <p style={{ marginTop: 'var(--sp-4)' }}>
        <Link to="/returns">← Back to my returns</Link>
      </p>
    </>
  )
}
