import { Link } from 'react-router-dom'
import { ArrowRight, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { useCart } from '../../lib/cart'
import { productImageFor } from '../../lib/productImage'
import { EmptyState, ErrorState, LoadingState, PageHead } from '../../components/ui'
import styles from './cart.module.css'

function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

export default function CartPage() {
  // Cart reads and writes live in the shared provider, so this page and the
  // store grid can never disagree about quantities or the subtotal.
  const { cart, ready, error, pendingId, setQuantity, remove, refresh } = useCart()
  const loading = !ready
  const inlineError = error

  async function updateQuantity(productId: string, quantity: number): Promise<void> {
    await setQuantity(productId, quantity)
  }

  async function removeLine(productId: string): Promise<void> {
    await remove(productId)
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <PageHead kicker="Store" title="Your cart" lede="Review items before checkout." />
        <LoadingState label="Loading cart" />
      </div>
    )
  }

  if (error !== null && cart.items.length === 0) {
    return (
      <div className={styles.page}>
        <PageHead kicker="Store" title="Your cart" lede="Review items before checkout." />
        <ErrorState message={error} onRetry={() => void refresh()} />
      </div>
    )
  }

  if (cart.items.length === 0) {
    return (
      <div className={styles.page}>
        <PageHead kicker="Store" title="Your cart" lede="Review items before checkout." />
        <EmptyState
          title="Your cart is empty"
          body="Browse the store and add products to get started."
          action={
            <Link className={styles.btn} to="/customer/store">
              <ShoppingBag size={16} aria-hidden="true" /> Continue shopping
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHead kicker="Store" title="Your cart" lede="Adjust quantities or remove items before checkout." />

      {inlineError && (
        <p className={styles.inlineError} role="alert">
          {inlineError}
        </p>
      )}

      <div className={styles.layout}>
        <ul className={styles.list} aria-label="Cart items">
          {cart.items.map((line) => {
            const busy = pendingId === line.productId
            return (
              <li key={line.productId} className={styles.card}>
                <img
                  className={styles.thumb}
                  src={productImageFor({
                    imageUrl: line.imageUrl,
                    name: line.name,
                    productId: line.productId,
                    sku: line.sku,
                  })}
                  alt={line.name}
                  loading="lazy"
                />
                <div className={styles.cardBody}>
                  <p className={styles.cardName}>{line.name}</p>
                  <span className={styles.unitPrice}>
                    {formatPaise(line.pricePaise)} each · {line.stock} in stock
                  </span>
                  <div className={styles.cardFoot}>
                    <div className={styles.stepper} role="group" aria-label={`Quantity for ${line.name}`}>
                      <button
                        type="button"
                        className={styles.stepperBtn}
                        aria-label={`Decrease quantity for ${line.name}`}
                        disabled={busy}
                        onClick={() =>
                          void (line.quantity <= 1
                            ? removeLine(line.productId)
                            : updateQuantity(line.productId, line.quantity - 1))
                        }
                      >
                        <Minus size={15} aria-hidden="true" />
                      </button>
                      <span className={styles.stepperValue} aria-live="polite">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        className={styles.stepperBtn}
                        aria-label={`Increase quantity for ${line.name}`}
                        disabled={busy || line.quantity >= line.stock}
                        onClick={() => void updateQuantity(line.productId, line.quantity + 1)}
                      >
                        <Plus size={15} aria-hidden="true" />
                      </button>
                    </div>
                    <span className={styles.lineTotal}>{formatPaise(line.lineTotalPaise)}</span>
                  </div>
                  <div>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      disabled={busy}
                      onClick={() => void removeLine(line.productId)}
                      aria-label={`Remove ${line.name} from cart`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      {busy ? 'Updating…' : 'Remove'}
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>

        <section className={styles.summary} aria-label="Cart summary">
          <h2>Summary</h2>
          <div className={styles.summaryRow}>
            <span>Total quantity</span>
            <span className={styles.mono}>{cart.totalQuantity}</span>
          </div>
          <div className={`${styles.summaryRow} ${styles.summaryRowTotal}`}>
            <span>Subtotal</span>
            <span className={styles.mono}>{formatPaise(cart.subtotalPaise)}</span>
          </div>
          <div className={styles.actions}>
            <Link className={`${styles.btn} ${styles.btnPrimary}`} to="/customer/checkout">
              Proceed to checkout <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link className={styles.btn} to="/customer/store">
              <ShoppingBag size={16} aria-hidden="true" /> Continue shopping
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}
