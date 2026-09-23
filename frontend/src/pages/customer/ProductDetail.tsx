import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Minus, Plus, ShoppingCart, Zap } from 'lucide-react'
import { ApiError, api, friendlyMessage } from '../../lib/api'
import type { Product } from '../../lib/api'
import { productImageFor } from '../../lib/productImage'
import { useCart } from '../../lib/cart'
import { ErrorState, FieldError, LoadingState, PageHead, StatusBadge } from '../../components/ui'
import styles from './store.module.css'

function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

export default function ProductDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [quantity, setQuantity] = useState(1)
  const [pending, setPending] = useState(false)
  const [buyNowPending, setBuyNowPending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const { add, error: cartError, clearError, quantityOf } = useCart()

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      if (!id) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const data = await api<{ product: Product }>(`/products/${id}`)
        if (!cancelled) {
          setProduct(data.product)
          setQuantity(1)
        }
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 404) {
            setNotFound(true)
          } else {
            setError(friendlyMessage(err))
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id, attempt])

  if (loading) {
    return (
      <div className={styles.page}>
        <PageHead kicker="Store" title="Product detail" lede="Loading product information." />
        <LoadingState label="Loading product" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className={styles.page}>
        <Link className={styles.backLink} to="/customer/store">
          <ArrowLeft size={16} aria-hidden="true" /> Back to store
        </Link>
        <ErrorState message="Product not found. It may have been removed from the catalog." />
      </div>
    )
  }

  if (error || !product) {
    return (
      <div className={styles.page}>
        <Link className={styles.backLink} to="/customer/store">
          <ArrowLeft size={16} aria-hidden="true" /> Back to store
        </Link>
        <ErrorState message={error ?? 'Product could not be loaded.'} onRetry={() => setAttempt((value) => value + 1)} />
      </div>
    )
  }

  const outOfStock = product.stock <= 0
  const maxQuantity = Math.max(product.stock, 1)
  const clamped = Math.min(Math.max(quantity, 1), maxQuantity)
  const productId = product.id
  const currentProductName = product.name

  const inCart = quantityOf(productId)

  async function handleAdd(): Promise<void> {
    setPending(true)
    setNotice(null)
    clearError()
    await add(productId, clamped)
    setNotice(`${clamped} × ${currentProductName} added to your cart.`)
    setPending(false)
  }

  async function handleBuyNow(): Promise<void> {
    setBuyNowPending(true)
    setNotice(null)
    clearError()
    await add(productId, clamped)
    setBuyNowPending(false)
    // Straight to checkout; the cart page is one step back if they change their mind.
    navigate('/customer/checkout')
  }

  return (
    <div className={styles.page}>
      <Link className={styles.backLink} to="/customer/store">
        <ArrowLeft size={16} aria-hidden="true" /> Back to store
      </Link>
      <PageHead kicker="Store" title={product.name} lede={product.description ?? 'Product details and availability.'} />

      <div className={styles.detailGrid}>
        <div className={styles.detailImagePanel}>
          <img
            className={styles.detailImage}
            src={productImageFor({
              imageUrl: product.imageUrl,
              name: product.name,
              productId: product.id,
              sku: product.sku,
            })}
            alt={product.name}
          />
        </div>

        <section className={styles.detailPanel} aria-label="Product information">
          <StatusBadge tone={product.stock <= 0 ? 'bad' : product.stock <= 5 ? 'warn' : 'ok'}>
            {product.stock <= 0 ? 'Out of stock' : product.stock <= 5 ? `Low stock — ${product.stock} left` : 'In stock'}
          </StatusBadge>
          <h2 className={styles.detailName}>{product.name}</h2>
          <p className={styles.detailPrice}>{formatPaise(product.pricePaise)}</p>
          <p className={styles.sku}>SKU: {product.sku}</p>
          {product.description && <p className={styles.detailText}>{product.description}</p>}
          {product.details && <p className={styles.detailText}>{product.details}</p>}

          {!outOfStock && (
            <div>
              <span className={styles.sku} id="qty-label">
                Quantity (1 to {product.stock})
              </span>
              <div className={styles.stepper} role="group" aria-labelledby="qty-label" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className={styles.stepperBtn}
                  aria-label={`Decrease quantity for ${product.name}`}
                  disabled={clamped <= 1 || pending || buyNowPending}
                  onClick={() => setQuantity(clamped - 1)}
                >
                  <Minus size={16} aria-hidden="true" />
                </button>
                <span className={styles.stepperValue} aria-live="polite">
                  {clamped}
                </span>
                <button
                  type="button"
                  className={styles.stepperBtn}
                  aria-label={`Increase quantity for ${product.name}`}
                  disabled={clamped >= product.stock || pending || buyNowPending}
                  onClick={() => setQuantity(clamped + 1)}
                >
                  <Plus size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          <div className={styles.cardActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={outOfStock || pending || buyNowPending}
              onClick={() => void handleAdd()}
            >
              <ShoppingCart size={15} aria-hidden="true" />
              {pending ? 'Adding…' : outOfStock ? 'Out of stock' : 'Add to Cart'}
            </button>
            <button
              type="button"
              className={styles.btn}
              disabled={outOfStock || pending || buyNowPending}
              onClick={() => void handleBuyNow()}
            >
              <Zap size={15} aria-hidden="true" />
              {buyNowPending ? 'Adding…' : 'Buy Now'}
            </button>
          </div>

          {notice && (
            <p className={styles.confirm} role="status">
              {notice}
            </p>
          )}
          {inCart > 0 && (
            <p className={styles.cardNote}>
              <Link className={styles.btnGhost} to="/customer/cart">
                {inCart} already in your cart — view cart
              </Link>
            </p>
          )}
          <FieldError id="product-add-error" message={cartError} />

          <dl className={styles.detailMeta}>
            <div>
              <dt>Availability</dt>
              <dd>{outOfStock ? 'Currently unavailable' : `${product.stock} unit(s) available`}</dd>
            </div>
            <div>
              <dt>SKU</dt>
              <dd className={styles.sku}>{product.sku}</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>{formatPaise(product.pricePaise)}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  )
}
