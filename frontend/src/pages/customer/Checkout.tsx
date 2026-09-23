import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, MapPin, Plus } from 'lucide-react'
import { ApiError, api, friendlyMessage } from '../../lib/api'
import type { AddressRow, OrderDetail, Quote } from '../../lib/api'
import { EmptyState, ErrorState, FieldError, LoadingState, PageHead } from '../../components/ui'
import { productImageFor } from '../../lib/productImage'
import { useCart } from '../../lib/cart'
import styles from './checkout.module.css'

function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* fall through to random fallback */
  }
  return `order-${Date.now()}-${Math.floor(Math.random() * 1000000)}`
}

interface CheckoutOrderResponse {
  order: OrderDetail | Record<string, unknown>
}

function extractOrderId(order: CheckoutOrderResponse['order']): string | null {
  if (!order || typeof order !== 'object') return null
  const asDetail = order as { order?: { id?: unknown }; id?: unknown }
  if (asDetail.order && typeof asDetail.order === 'object' && typeof asDetail.order.id === 'string') {
    return asDetail.order.id
  }
  if (typeof asDetail.id === 'string') return asDetail.id
  return null
}

export default function Checkout() {
  const navigate = useNavigate()
  const [addresses, setAddresses] = useState<AddressRow[]>([])
  const [addressesLoading, setAddressesLoading] = useState(true)
  const [addressesError, setAddressesError] = useState<string | null>(null)
  // The cart comes from the shared provider so the nav badge, the store grid,
  // and this page always show the same basket.
  const { cart, ready: cartReady, error: cartError, refresh: refreshCart } = useCart()
  const cartLoading = !cartReady

  const [addressId, setAddressId] = useState('')
  const [useStoreCredit, setUseStoreCredit] = useState(false)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ fullName: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: 'India', phone: '' })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [savingAddress, setSavingAddress] = useState(false)
  const [addressFormError, setAddressFormError] = useState<string | null>(null)

  const [placing, setPlacing] = useState(false)
  const [placeError, setPlaceError] = useState<string | null>(null)
  const idempotencyKey = useRef<string>(newIdempotencyKey())

  async function loadAddresses(selectId?: string): Promise<void> {
    setAddressesLoading(true)
    setAddressesError(null)
    try {
      const data = await api<{ addresses: AddressRow[] }>('/addresses')
      setAddresses(data.addresses)
      if (selectId) {
        setAddressId(selectId)
      } else if (!addressId) {
        const def = data.addresses.find((row) => row.is_default === 1) ?? data.addresses[0]
        if (def) setAddressId(def.id)
      }
    } catch (err) {
      setAddressesError(friendlyMessage(err))
    } finally {
      setAddressesLoading(false)
    }
  }

  useEffect(() => {
    void loadAddresses()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    async function fetchQuote(): Promise<void> {
      if (!addressId || !cart || cart.items.length === 0) {
        setQuote(null)
        return
      }
      setQuoteLoading(true)
      setQuoteError(null)
      try {
        const data = await api<Quote>('/checkout/quote', { method: 'POST', body: { addressId, useStoreCredit } })
        if (!cancelled) setQuote(data)
      } catch (err) {
        if (!cancelled) setQuoteError(friendlyMessage(err))
      } finally {
        if (!cancelled) setQuoteLoading(false)
      }
    }
    void fetchQuote()
    return () => {
      cancelled = true
    }
  }, [addressId, useStoreCredit, cart])

  function setField(key: keyof typeof form, value: string): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleAddAddress(event: FormEvent): Promise<void> {
    event.preventDefault()
    const problems: Record<string, string> = {}
    if (form.fullName.trim() === '') problems.fullName = 'Enter the full name for this address.'
    if (form.line1.trim() === '') problems.line1 = 'Enter the street address.'
    if (form.city.trim() === '') problems.city = 'Enter the city.'
    if (form.state.trim() === '') problems.state = 'Enter the state.'
    if (form.postalCode.trim() === '') problems.postalCode = 'Enter the postal code.'
    if (form.phone.trim() !== '' && !/^[+\d][\d\s-]{5,18}$/.test(form.phone.trim())) {
      problems.phone = 'Enter a valid phone number.'
    }
    setFieldErrors(problems)
    if (Object.keys(problems).length > 0) return
    setSavingAddress(true)
    setAddressFormError(null)
    try {
      const data = await api<{ address: AddressRow }>('/addresses', {
        method: 'POST',
        body: {
          fullName: form.fullName.trim(),
          line1: form.line1.trim(),
          line2: form.line2.trim() === '' ? undefined : form.line2.trim(),
          city: form.city.trim(),
          state: form.state.trim(),
          postalCode: form.postalCode.trim(),
          country: form.country.trim() === '' ? undefined : form.country.trim(),
          phone: form.phone.trim() === '' ? undefined : form.phone.trim(),
        },
      })
      setAddresses((prev) => [...prev, data.address])
      setAddressId(data.address.id)
      setFormOpen(false)
      setForm({ fullName: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: 'India', phone: '' })
    } catch (err) {
      setAddressFormError(friendlyMessage(err))
    } finally {
      setSavingAddress(false)
    }
  }

  async function handlePlaceOrder(): Promise<void> {
    if (!addressId) {
      setPlaceError('Select a delivery address to continue.')
      return
    }
    if (!cart || cart.items.length === 0) {
      setPlaceError('Your cart is empty. Add items before placing an order.')
      return
    }
    setPlacing(true)
    setPlaceError(null)
    try {
      const data = await api<CheckoutOrderResponse>('/checkout', {
        method: 'POST',
        body: { addressId, useStoreCredit, idempotencyKey: idempotencyKey.current },
      })
      const orderId = extractOrderId(data.order)
      if (!orderId) {
        throw new Error('Order was placed but the order reference was missing. Please check My Orders.')
      }
      await refreshCart()
      navigate(`/customer/orders/${orderId}`, { state: { ordered: true } })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMPTY_CART') {
        setPlaceError('Your cart is empty. Add items before placing an order.')
      } else {
        setPlaceError(friendlyMessage(err))
      }
    } finally {
      setPlacing(false)
    }
  }

  if (cartLoading || addressesLoading) {
    return (
      <div className={styles.page}>
        <PageHead kicker="Store" title="Checkout" lede="Choose an address and confirm your order." />
        <LoadingState label="Loading checkout" />
      </div>
    )
  }

  if (cartError !== null || addressesError || !cart) {
    return (
      <div className={styles.page}>
        <PageHead kicker="Store" title="Checkout" lede="Choose an address and confirm your order." />
        <ErrorState
          message={cartError ?? addressesError ?? 'Checkout could not be loaded.'}
          onRetry={() => {
            void refreshCart()
            void loadAddresses()
          }}
        />
      </div>
    )
  }

  if (cart.items.length === 0) {
    return (
      <div className={styles.page}>
        <PageHead kicker="Store" title="Checkout" lede="Choose an address and confirm your order." />
        <p className={styles.testBanner} role="note">
          Test checkout — no real payment is processed.
        </p>
        <EmptyState
          title="Your cart is empty"
          body="Add products from the store before checking out."
          action={
            <Link className={styles.btn} to="/customer/store">
              Back to store
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHead kicker="Store" title="Checkout" lede="Confirm your address, review items, and place your order." />
      <p className={styles.testBanner} role="note">
        Test checkout — no real payment is processed.
      </p>

      <section className={styles.panel} aria-labelledby="step-address">
        <h2 id="step-address">
          <span className={styles.stepNum} aria-hidden="true">
            1
          </span>
          Delivery address
        </h2>
        <p className={styles.panelLede}>Select where the order should be delivered.</p>
        {addresses.length === 0 && !formOpen ? (
          <p className={styles.panelLede}>No addresses yet. Add one below to continue.</p>
        ) : (
          <ul className={styles.addressList} role="radiogroup" aria-label="Delivery addresses">
            {addresses.map((row) => (
              <label key={row.id} className={`${styles.radio} ${addressId === row.id ? styles.radioChecked : ''}`}>
                <input
                  type="radio"
                  name="checkout-address"
                  value={row.id}
                  checked={addressId === row.id}
                  onChange={() => setAddressId(row.id)}
                />
                <span>
                  <span className={styles.radioTitle}>
                    <MapPin size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 4 }} />
                    {row.label ?? row.full_name}
                  </span>
                  <br />
                  <span className={styles.radioDesc}>
                    {row.full_name}, {row.line1}, {row.city}, {row.state} {row.postal_code}
                  </span>
                </span>
              </label>
            ))}
          </ul>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={() => setFormOpen((value) => !value)} aria-expanded={formOpen}>
            <Plus size={15} aria-hidden="true" /> {formOpen ? 'Hide address form' : 'Add a new address'}
          </button>
        </div>
        {formOpen && (
          <form className={styles.form} onSubmit={(event) => void handleAddAddress(event)} noValidate>
            <div className={styles.grid2}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="co-name">
                  Full name
                </label>
                <input id="co-name" className={styles.input} type="text" value={form.fullName} onChange={(event) => setField('fullName', event.target.value)} aria-describedby="co-name-error" maxLength={120} autoComplete="name" />
                <FieldError id="co-name-error" message={fieldErrors.fullName ?? null} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="co-phone">
                  Phone (optional)
                </label>
                <input id="co-phone" className={styles.input} type="tel" value={form.phone} onChange={(event) => setField('phone', event.target.value)} aria-describedby="co-phone-error" maxLength={24} autoComplete="tel" />
                <FieldError id="co-phone-error" message={fieldErrors.phone ?? null} />
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="co-line1">
                Street address
              </label>
              <input id="co-line1" className={styles.input} type="text" value={form.line1} onChange={(event) => setField('line1', event.target.value)} aria-describedby="co-line1-error" maxLength={200} autoComplete="street-address" />
              <FieldError id="co-line1-error" message={fieldErrors.line1 ?? null} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="co-line2">
                Apartment, suite, landmark (optional)
              </label>
              <input id="co-line2" className={styles.input} type="text" value={form.line2} onChange={(event) => setField('line2', event.target.value)} maxLength={200} />
            </div>
            <div className={styles.grid2}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="co-city">
                  City
                </label>
                <input id="co-city" className={styles.input} type="text" value={form.city} onChange={(event) => setField('city', event.target.value)} aria-describedby="co-city-error" maxLength={100} autoComplete="address-level2" />
                <FieldError id="co-city-error" message={fieldErrors.city ?? null} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="co-state">
                  State
                </label>
                <input id="co-state" className={styles.input} type="text" value={form.state} onChange={(event) => setField('state', event.target.value)} aria-describedby="co-state-error" maxLength={100} autoComplete="address-level1" />
                <FieldError id="co-state-error" message={fieldErrors.state ?? null} />
              </div>
            </div>
            <div className={styles.grid2}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="co-postal">
                  Postal code
                </label>
                <input id="co-postal" className={styles.input} type="text" value={form.postalCode} onChange={(event) => setField('postalCode', event.target.value)} aria-describedby="co-postal-error" maxLength={20} autoComplete="postal-code" />
                <FieldError id="co-postal-error" message={fieldErrors.postalCode ?? null} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="co-country">
                  Country
                </label>
                <input id="co-country" className={styles.input} type="text" value={form.country} onChange={(event) => setField('country', event.target.value)} maxLength={100} autoComplete="country-name" />
              </div>
            </div>
            {addressFormError && (
              <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
                {addressFormError}
              </p>
            )}
            <div className={styles.actions}>
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={savingAddress}>
                {savingAddress ? 'Saving…' : 'Save and use this address'}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="step-items">
        <h2 id="step-items">
          <span className={styles.stepNum} aria-hidden="true">
            2
          </span>
          Review items
        </h2>
        <p className={styles.panelLede}>
          {cart.totalQuantity} item(s) · Subtotal {formatPaise(cart.subtotalPaise)}
        </p>
        <ul className={styles.itemList}>
          {cart.items.map((line) => (
            <li key={line.productId} className={styles.itemRow}>
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
              <div className={styles.itemMain}>
                <div className={styles.itemName}>{line.name}</div>
                <div className={styles.itemMeta}>
                  {line.quantity} × {formatPaise(line.pricePaise)}
                </div>
              </div>
              <span className={styles.itemTotal}>{formatPaise(line.lineTotalPaise)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.panel} aria-labelledby="step-credit">
        <h2 id="step-credit">
          <span className={styles.stepNum} aria-hidden="true">
            3
          </span>
          Store credit
        </h2>
        <p className={styles.panelLede}>Apply available store credit to reduce the amount payable.</p>
        <label className={styles.checkRow} htmlFor="use-credit">
          <input id="use-credit" type="checkbox" checked={useStoreCredit} onChange={(event) => setUseStoreCredit(event.target.checked)} />
          Use store credit for this order
        </label>
        {quoteLoading && <p className={styles.panelLede}>Updating price summary…</p>}
        {quoteError && (
          <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
            {quoteError}
          </p>
        )}
        {quote && (
          <div className={styles.quoteBox} aria-live="polite">
            <div className={styles.quoteRow}>
              <span>Subtotal</span>
              <span className={styles.mono}>{formatPaise(quote.subtotalPaise)}</span>
            </div>
            <div className={styles.quoteRow}>
              <span>Shipping</span>
              <span className={styles.mono}>{formatPaise(quote.shippingPaise)}</span>
            </div>
            <div className={styles.quoteRow}>
              <span>Discount</span>
              <span className={styles.mono}>−{formatPaise(quote.discountPaise)}</span>
            </div>
            <div className={styles.quoteRow}>
              <span>Store credit available</span>
              <span className={styles.mono}>{formatPaise(quote.creditAvailablePaise)}</span>
            </div>
            <div className={styles.quoteRow}>
              <span>Store credit used</span>
              <span className={styles.mono}>−{formatPaise(quote.creditToUsePaise)}</span>
            </div>
            <div className={`${styles.quoteRow} ${styles.quoteRowTotal}`}>
              <span>Payable</span>
              <span className={styles.mono}>{formatPaise(quote.payablePaise)}</span>
            </div>
          </div>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="step-review">
        <h2 id="step-review">
          <span className={styles.stepNum} aria-hidden="true">
            4
          </span>
          Review and place order
        </h2>
        <p className={styles.panelLede}>Placing the order clears your cart. This is a test checkout with no real payment.</p>
        {placeError && (
          <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
            {placeError}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={placing || !addressId} onClick={() => void handlePlaceOrder()}>
            {placing ? 'Placing order…' : 'Place Order'}
            {!placing && <ArrowRight size={16} aria-hidden="true" />}
          </button>
          <Link className={styles.btn} to="/customer/cart">
            Back to cart
          </Link>
        </div>
      </section>
    </div>
  )
}
