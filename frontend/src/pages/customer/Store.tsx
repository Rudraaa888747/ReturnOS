import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Minus, Plus, Search, ShoppingBag, ShoppingCart } from 'lucide-react'
import { api, friendlyMessage } from '../../lib/api'
import type { Product } from '../../lib/api'
import { productImageFor } from '../../lib/productImage'
import { useCart } from '../../lib/cart'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge } from '../../components/ui'
import styles from './store.module.css'

function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

type Availability = { label: string; tone: 'ok' | 'warn' | 'bad' }

/** Availability wording comes from the stock the backend reports, never a guess. */
function availabilityOf(stock: number): Availability {
  if (stock <= 0) return { label: 'Out of stock', tone: 'bad' }
  if (stock <= 5) return { label: `Only ${stock} left`, tone: 'warn' }
  return { label: 'In stock', tone: 'ok' }
}

export default function Store() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [justAdded, setJustAdded] = useState<string | null>(null)

  const { cart, error: cartError, pendingId, quantityOf, add, setQuantity, clearError } = useCart()

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true)
      setError(null)
      try {
        const data = await api<{ products: Product[] }>('/products')
        if (!cancelled) setProducts(data.products)
      } catch (err) {
        if (!cancelled) setError(friendlyMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [attempt])

  // Clear the "added" flash shortly after it appears.
  useEffect(() => {
    if (justAdded === null) return
    const timer = window.setTimeout(() => setJustAdded(null), 2200)
    return () => window.clearTimeout(timer)
  }, [justAdded])

  const visible = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (trimmed === '') return products
    return products.filter((product) =>
      [product.name, product.description, product.sku].join(' ').toLowerCase().includes(trimmed),
    )
  }, [products, query])

  async function handleAdd(product: Product): Promise<void> {
    await add(product.id, 1)
    setJustAdded(product.id)
  }

  const head = (
    <PageHead
      kicker="Store"
      title="Shop products"
      lede="Everything in the ReturnOS catalogue, with live pricing and availability."
    />
  )

  if (loading) {
    return (
      <div className={styles.page}>
        {head}
        <LoadingState label="Loading products" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.page}>
        {head}
        <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {head}

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search size={16} aria-hidden="true" className={styles.searchIcon} />
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search products"
            aria-label="Search products"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <Link className={styles.cartLink} to="/customer/cart">
          <ShoppingCart size={16} aria-hidden="true" />
          <span>
            {cart.totalQuantity === 0 ? 'Cart empty' : `Cart · ${formatPaise(cart.subtotalPaise)}`}
          </span>
          {cart.totalQuantity > 0 && <span className={styles.cartBadge}>{cart.totalQuantity}</span>}
        </Link>
      </div>

      {cartError && (
        <p className={styles.inlineError} role="alert" onAnimationEnd={clearError}>
          {cartError}
        </p>
      )}

      {visible.length === 0 ? (
        <EmptyState
          title={query.trim() === '' ? 'No products available' : 'No matching products'}
          body={
            query.trim() === ''
              ? 'The catalogue is empty right now. Please check back later.'
              : 'Try a different search term.'
          }
          action={
            query.trim() === '' ? (
              <Link className={styles.btn} to="/customer/orders">
                <ShoppingBag size={16} aria-hidden="true" /> View my orders
              </Link>
            ) : (
              <button type="button" className={styles.btn} onClick={() => setQuery('')}>
                Clear search
              </button>
            )
          }
        />
      ) : (
        <ul className={styles.grid}>
          {visible.map((product) => {
            const availability = availabilityOf(product.stock)
            const outOfStock = product.stock <= 0
            const inCart = quantityOf(product.id)
            const busy = pendingId === product.id
            const href = `/customer/store/products/${product.id}`

            return (
              <li key={product.id} className={styles.card}>
                <Link className={styles.imageWrap} to={href} aria-label={`View ${product.name}`}>
                  <img
                    className={styles.image}
                    src={productImageFor({
                      imageUrl: product.imageUrl,
                      name: product.name,
                      productId: product.id,
                      sku: product.sku,
                    })}
                    alt={product.name}
                    loading="lazy"
                  />
                  {outOfStock && <span className={styles.soldOut}>Sold out</span>}
                </Link>

                <div className={styles.cardBody}>
                  <div className={styles.cardTop}>
                    <h2 className={styles.cardName}>
                      <Link to={href}>{product.name}</Link>
                    </h2>
                    <span className={styles.sku}>{product.sku}</span>
                  </div>

                  {product.description && <p className={styles.cardDesc}>{product.description}</p>}

                  <div className={styles.priceRow}>
                    <span className={styles.price}>{formatPaise(product.pricePaise)}</span>
                    <StatusBadge tone={availability.tone}>{availability.label}</StatusBadge>
                  </div>

                  <div className={styles.cardActions}>
                    {inCart > 0 ? (
                      <div className={styles.stepper} role="group" aria-label={`Quantity for ${product.name}`}>
                        <button
                          type="button"
                          className={styles.stepperBtn}
                          aria-label={`Decrease quantity for ${product.name}`}
                          disabled={busy}
                          onClick={() => void setQuantity(product.id, inCart - 1)}
                        >
                          <Minus size={15} aria-hidden="true" />
                        </button>
                        <span className={styles.stepperValue} aria-live="polite">
                          {inCart}
                        </span>
                        <button
                          type="button"
                          className={styles.stepperBtn}
                          aria-label={`Increase quantity for ${product.name}`}
                          disabled={busy || inCart >= product.stock}
                          onClick={() => void setQuantity(product.id, inCart + 1)}
                        >
                          <Plus size={15} aria-hidden="true" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnPrimary}`}
                        disabled={outOfStock || busy}
                        onClick={() => void handleAdd(product)}
                        aria-label={outOfStock ? `${product.name} is out of stock` : `Add ${product.name} to cart`}
                      >
                        <ShoppingCart size={15} aria-hidden="true" />
                        {busy ? 'Adding…' : outOfStock ? 'Out of stock' : 'Add to Cart'}
                      </button>
                    )}

                    <Link className={styles.btnGhost} to={href}>
                      Details <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  </div>

                  <p className={styles.cardNote} role="status">
                    {justAdded === product.id ? (
                      <span className={styles.confirm}>
                        <Check size={13} aria-hidden="true" /> Added to cart
                      </span>
                    ) : inCart > 0 ? (
                      <span className={styles.inCart}>{inCart} in your cart</span>
                    ) : (
                      ' '
                    )}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {cart.totalQuantity > 0 && (
        <div className={styles.checkoutBar}>
          <div>
            <span className={styles.checkoutCount}>
              {cart.totalQuantity} item{cart.totalQuantity === 1 ? '' : 's'} in your cart
            </span>
            <span className={styles.checkoutTotal}>{formatPaise(cart.subtotalPaise)}</span>
          </div>
          <div className={styles.checkoutActions}>
            <Link className={styles.btn} to="/customer/cart">
              View cart
            </Link>
            <Link className={`${styles.btn} ${styles.btnPrimary}`} to="/customer/checkout">
              Checkout <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
