import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, LifeBuoy, PackageSearch } from 'lucide-react'
import { ApiError, api, friendlyMessage } from '../../lib/api'
import type { OrderDetail, OrderTracking } from '../../lib/api'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge, statusTone } from '../../components/ui'
import { orderItemImageFor } from '../../lib/productImage'
import styles from './orders.module.css'

function formatMoney(value: number): string {
  return `₹${value.toLocaleString('en-IN')}`
}

function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function pickNumber(...candidates: Array<number | null | undefined>): number | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
  }
  return null
}

function pickString(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
  }
  return null
}

function parseShippingAddress(raw: string | null | undefined): string | null {
  if (!raw || raw.trim() === '') return null
  const trimmed = raw.trim()
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === 'string') return parsed
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const parts = [
        record.full_name ?? record.fullName,
        record.line1,
        record.line2,
        [record.city, record.state, record.postal_code ?? record.postalCode].filter(Boolean).join(', ') || null,
        record.country,
        record.phone,
      ].filter((part): part is string => typeof part === 'string' && part.trim() !== '')
      if (parts.length > 0) return parts.join(' · ')
    }
  } catch {
    /* not JSON — treat as plain text */
  }
  return trimmed
}

export default function OrderDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const ordered = ((location.state as { ordered?: boolean } | null) ?? {}).ordered === true
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [tracking, setTracking] = useState<OrderTracking | null>(null)
  const [trackingError, setTrackingError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const trackingRef = useRef<HTMLElement | null>(null)

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
        const data = await api<OrderDetail>(`/orders/${id}`)
        if (!cancelled) {
          setDetail(data)
        }
        try {
          const track = await api<OrderTracking>(`/orders/${id}/tracking`)
          if (!cancelled) setTracking(track)
        } catch (trackErr) {
          if (!cancelled) {
            if (trackErr instanceof ApiError && trackErr.status === 404) {
              setTracking(null)
            } else {
              setTrackingError(friendlyMessage(trackErr))
            }
          }
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
        <PageHead kicker="Customer" title="Order detail" lede="Loading order information." />
        <LoadingState label="Loading order" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className={styles.page}>
        <PageHead kicker="Customer" title="Order detail" lede="Check the order link and try again." />
        <ErrorState message="Order not found" />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className={styles.page}>
        <PageHead kicker="Customer" title="Order detail" lede="Check the order link and try again." />
        <ErrorState message={error ?? 'Order could not be loaded.'} onRetry={() => setAttempt((value) => value + 1)} />
      </div>
    )
  }

  const { order, items, eligible, eligibleUntil, ineligibleReason } = detail
  const eligibleItems = items.filter((item) => item.eligible && item.remaining_quantity > 0)

  const shippingPaise = pickNumber(order.shipping_paise, order.shippingPaise)
  const discountPaise = pickNumber(order.discount_paise, order.discountPaise)
  const creditPaise = pickNumber(order.credit_used_paise, order.creditUsedPaise)
  const totalPaise = pickNumber(order.totalPaise, order.total != null && order.total > 10000 ? order.total : null)
  const subtotalPaise = pickNumber(order.subtotalPaise)
  const subtotalDisplay = subtotalPaise !== null ? formatPaise(subtotalPaise) : formatMoney(order.subtotal)
  const totalDisplay = totalPaise !== null ? formatPaise(totalPaise) : subtotalDisplay

  const shippingAddressRaw = pickString(order.shipping_address, order.shippingAddress)
  const shippingAddress = parseShippingAddress(shippingAddressRaw)
  const paymentStatus = pickString(order.payment_status, order.paymentStatus)
  const carrier = pickString(order.carrier, tracking?.carrier)
  const trackingNumber = pickString(order.tracking_number, order.trackingNumber, tracking?.trackingNumber)
  const estimatedDelivery = pickString(order.estimated_delivery, order.estimatedDelivery, tracking?.estimatedDelivery)

  function scrollToTracking(): void {
    trackingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Customer"
        title={`Order ${order.order_number}`}
        lede="Review items, remaining quantities, and eligibility before starting a return."
        actions={<Link to="/customer/orders">Back to orders</Link>}
      />

      {ordered && (
        <div className={`${styles.banner} ${styles.bannerOk}`} role="status">
          <span className={styles.bannerIcon} aria-hidden="true">
            <CheckCircle2 size={18} />
          </span>
          <div>
            <div className={styles.bannerTitle}>Order placed successfully</div>
            <p className={styles.bannerText}>Thank you. Your order confirmation is shown below.</p>
          </div>
        </div>
      )}

      <section className={styles.panel} aria-label="Order summary">
        <div className={styles.metaGrid}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Order number</span>
            <span className={`${styles.metaValue} ${styles.mono}`}>{order.order_number}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Status</span>
            <span className={styles.metaValue}>
              <StatusBadge tone={statusTone(order.status)}>{order.status}</StatusBadge>
            </span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Subtotal</span>
            <span className={`${styles.metaValue} ${styles.mono}`}>{subtotalDisplay}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Placed on</span>
            <span className={`${styles.metaValue} ${styles.mono}`}>{formatDate(order.created_at)}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Delivered on</span>
            <span className={`${styles.metaValue} ${styles.mono}`}>{formatDate(order.delivered_at)}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Payment</span>
            <span className={styles.metaValue}>{paymentStatus ?? '—'}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Delivery</span>
            <span className={styles.metaValue}>{estimatedDelivery ? `ETA ${formatDate(estimatedDelivery)}` : formatDate(order.delivered_at)}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Carrier</span>
            <span className={styles.metaValue}>
              {carrier ?? '—'}
              {trackingNumber ? ` · ${trackingNumber}` : ''}
            </span>
          </div>
        </div>

        <h3 className={styles.sectionTitle}>Totals</h3>
        <dl className={styles.totalsList}>
          <div className={styles.totalsRow}>
            <dt>Subtotal</dt>
            <dd className={styles.mono}>{subtotalDisplay}</dd>
          </div>
          <div className={styles.totalsRow}>
            <dt>Shipping</dt>
            <dd className={styles.mono}>{shippingPaise !== null ? formatPaise(shippingPaise) : '—'}</dd>
          </div>
          <div className={styles.totalsRow}>
            <dt>Discount</dt>
            <dd className={styles.mono}>{discountPaise !== null ? `−${formatPaise(discountPaise)}` : '—'}</dd>
          </div>
          <div className={styles.totalsRow}>
            <dt>Store credit used</dt>
            <dd className={styles.mono}>{creditPaise !== null ? `−${formatPaise(creditPaise)}` : '—'}</dd>
          </div>
          <div className={`${styles.totalsRow} ${styles.totalsRowTotal}`}>
            <dt>Total</dt>
            <dd className={styles.mono}>{totalDisplay}</dd>
          </div>
        </dl>

        <h3 className={styles.sectionTitle} style={{ marginTop: '1rem' }}>
          Shipping address
        </h3>
        <p className={styles.addressText}>{shippingAddress ?? 'Shipping address is not available for this order.'}</p>

        <div className={styles.actionRow}>
          <button type="button" className={styles.actionBtn} onClick={scrollToTracking}>
            <PackageSearch size={15} aria-hidden="true" /> Track order
          </button>
          <Link className={styles.actionBtn} to="/customer/support">
            <LifeBuoy size={15} aria-hidden="true" /> Contact Support
          </Link>
        </div>

        {eligible ? (
          <div className={`${styles.banner} ${styles.bannerOk}`} role="status" style={{ marginTop: '1rem' }}>
            <span className={styles.bannerIcon} aria-hidden="true">
              <CheckCircle2 size={18} />
            </span>
            <div>
              <div className={styles.bannerTitle}>
                {eligibleUntil !== null ? `Eligible until ${formatDate(eligibleUntil)}` : 'This order is within the return window'}
              </div>
              <p className={styles.bannerText}>
                {eligibleItems.length > 0
                  ? `${eligibleItems.length} item(s) still have returnable quantity. Choose an item below to start a return.`
                  : 'The order is eligible, but every item has already been fully returned.'}
              </p>
            </div>
          </div>
        ) : (
          <div className={`${styles.banner} ${styles.bannerBad}`} role="status" style={{ marginTop: '1rem' }}>
            <span className={styles.bannerIcon} aria-hidden="true">
              <AlertTriangle size={18} />
            </span>
            <div>
              <div className={styles.bannerTitle}>{ineligibleReason ?? 'This order is not eligible for returns'}</div>
              <p className={styles.bannerText}>
                Returns are assessed by our system against the order's delivery date and what has already been
                returned. Contact support if you believe this is a mistake.
              </p>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="items-h">
        <h2 id="items-h" className={styles.sectionTitle}>
          Items
        </h2>
        {items.length === 0 ? (
          <EmptyState title="No items" body="This order has no line items to return." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">SKU</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Unit price</th>
                  <th scope="col">Remaining</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const canStart = item.eligible && item.remaining_quantity > 0
                  return (
                    <tr key={item.id}>
                      <td>
                        <span className={styles.itemCell}>
                          <img
                            className={styles.detailThumb}
                            src={orderItemImageFor(item)}
                            alt={item.product_name}
                            loading="lazy"
                          />
                          {item.product_name}
                        </span>
                      </td>
                      <td className={styles.mono}>{item.sku}</td>
                      <td className={styles.mono}>{item.quantity}</td>
                      <td className={styles.mono}>{formatMoney(item.unit_price)}</td>
                      <td className={styles.mono}>{item.remaining_quantity}</td>
                      <td>
                        {canStart ? (
                          <Link
                            className={styles.startLink}
                            to={`/customer/returns/new?orderId=${order.id}&itemId=${item.id}`}
                          >
                            Start return
                          </Link>
                        ) : (
                          <span className={styles.ineligible}>{item.ineligibleReason ?? 'Not eligible'}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="tracking-h" ref={trackingRef} tabIndex={-1}>
        <h2 id="tracking-h" className={styles.sectionTitle}>
          Tracking
        </h2>
        {trackingError ? (
          <p className={styles.ineligible} role="alert">
            Tracking could not be loaded: {trackingError}
          </p>
        ) : !tracking ? (
          <p className={styles.ineligible}>Tracking information is not available for this order yet.</p>
        ) : (
          <>
            <div className={styles.metaGrid}>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Status</span>
                <span className={styles.metaValue}>
                  <StatusBadge tone={statusTone(tracking.status)}>{tracking.status}</StatusBadge>
                </span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Carrier</span>
                <span className={styles.metaValue}>{tracking.carrier ?? '—'}</span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Tracking number</span>
                <span className={`${styles.metaValue} ${styles.mono}`}>{tracking.trackingNumber ?? '—'}</span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>Estimated delivery</span>
                <span className={`${styles.metaValue} ${styles.mono}`}>{formatDate(tracking.estimatedDelivery)}</span>
              </div>
            </div>
            {tracking.events.length === 0 ? (
              <p className={styles.ineligible}>No tracking events yet.</p>
            ) : (
              <ol className={styles.timeline}>
                {tracking.events.map((event) => (
                  <li key={event.id} className={styles.timelineItem}>
                    <span className={styles.timelineDot} aria-hidden="true" />
                    <div className={styles.timelineBody}>
                      <span className={styles.timelineStatus}>{event.status.replaceAll('_', ' ')}</span>
                      <span className={styles.timelineDate}>{formatDate(event.created_at)}</span>
                      {event.description && <span className={styles.timelineDesc}>{event.description}</span>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </section>
    </div>
  )
}
