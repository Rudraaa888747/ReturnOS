import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ad } from '../../lib/admin'
import type { AdminOrderDetail } from '../../lib/admin'
import { ErrorState, LoadingState, PageHead, StatusBadge, statusTone } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

function formatMoneyPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

function money(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatMoneyPaise(value) : '—'
}

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

export default function OrderDetail() {
  const { id } = useParams()
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [attempt, setAttempt] = useState(0)

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
        const data = await ad<AdminOrderDetail>(`/orders/${id}`)
        if (!cancelled) setDetail(data)
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 404) {
            setNotFound(true)
          } else {
            setError(friendlyMessage(err))
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id, attempt])

  if (loading) {
    return (
      <div>
        <PageHead kicker="Admin" title="Order" lede="Loading the order file." />
        <LoadingState label="Loading order…" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div>
        <PageHead kicker="Admin" title="Order" lede="Check the link and try again." />
        <ErrorState message="Order not found." />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div>
        <PageHead kicker="Admin" title="Order" lede="Check the link and try again." />
        <ErrorState message={error ?? 'Order could not be loaded.'} onRetry={() => setAttempt((v) => v + 1)} />
      </div>
    )
  }

  const { order } = detail

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Admin"
        title={text(order.order_number)}
        lede={`Placed ${formatDate(typeof order.created_at === 'string' ? order.created_at : null)}`}
        actions={<Link to="/admin/orders">Back to orders</Link>}
      />

      <section className={ops.panel} aria-label="Order facts">
        <div className={styles.factGrid}>
          <Fact label="Status">
            <StatusBadge tone={statusTone(String(order.status))}>{String(order.status).replaceAll('_', ' ')}</StatusBadge>
          </Fact>
          <Fact label="Customer">
            <Link to={`/admin/customers/${order.customer_id}`}>{detail.customer.full_name}</Link>
          </Fact>
          <Fact label="Subtotal" mono>
            {money(order.subtotal_paise)}
          </Fact>
          <Fact label="Payment" mono>
            {text(order.payment_status)} · {text(order.payment_method)}
          </Fact>
          <Fact label="Kind" mono>
            {text(order.kind)}
          </Fact>
          <Fact label="Carrier" mono>
            {text(order.carrier)} {order.tracking_number ? `· ${String(order.tracking_number)}` : ''}
          </Fact>
        </div>
      </section>

      <section className={ops.panel} aria-label="Items">
        <h2 className={ops.panelTitle}>Items ({detail.items.length})</h2>
        <div className={ops.tableWrap}>
          <table className={ops.table}>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Qty</th>
                <th scope="col">Unit</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item) => (
                <tr key={String(item.id)}>
                  <td>
                    {String(item.product_name)}
                    <div className={ops.muted}>{String(item.sku)}</div>
                  </td>
                  <td className={ops.mono}>{String(item.quantity)}</td>
                  <td className={ops.mono}>{money(item.unit_price_paise)}</td>
                  <td className={ops.mono}>{money(item.line_total_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className={styles.twoCol}>
        <section className={ops.panel} aria-label="Linked returns and refunds">
          <h2 className={ops.panelTitle}>Returns ({detail.returns.length})</h2>
          {detail.returns.length === 0 ? (
            <p className={ops.muted}>No returns on this order.</p>
          ) : (
            <ul className={styles.plainList}>
              {detail.returns.map((ret) => (
                <li key={ret.id}>
                  <Link className={ops.mono} to={`/admin/returns/${ret.id}`}>
                    {ret.return_number}
                  </Link>{' '}
                  <StatusBadge tone={statusTone(ret.status)}>{ret.status.replaceAll('_', ' ')}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
          <h3 className={styles.subTitle}>Refunds ({detail.refunds.length})</h3>
          {detail.refunds.length === 0 ? (
            <p className={ops.muted}>No refunds.</p>
          ) : (
            <ul className={styles.plainList}>
              {detail.refunds.map((refund) => (
                <li key={refund.id}>
                  <span className={ops.mono}>
                    {money(refund.amount_paise)} · {refund.status.replaceAll('_', ' ')}
                  </span>{' '}
                  <span className={ops.muted}>{refund.return_number}</span>
                </li>
              ))}
            </ul>
          )}
          <h3 className={styles.subTitle}>Replacements ({detail.replacements.length})</h3>
          {detail.replacements.length === 0 ? (
            <p className={ops.muted}>No replacement orders.</p>
          ) : (
            <ul className={styles.plainList}>
              {detail.replacements.map((rep) => (
                <li key={rep.id}>
                  <Link className={ops.mono} to={`/admin/orders/${rep.id}`}>
                    {rep.order_number}
                  </Link>{' '}
                  <span className={ops.muted}>{rep.kind?.replaceAll('_', ' ') ?? ''}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={ops.panel} aria-label="Order timeline">
          <h2 className={ops.panelTitle}>Timeline</h2>
          {detail.events.length === 0 ? (
            <p className={ops.muted}>No events recorded.</p>
          ) : (
            <ol className={styles.timeline}>
              {detail.events.map((event) => (
                <li key={event.id} className={styles.timelineItem}>
                  <span className={styles.timelineStatus}>{event.status.replaceAll('_', ' ')}</span>
                  <span className={styles.timelineDate}>{formatDate(event.created_at)}</span>
                  {event.description && <span className={styles.timelineDesc}>{event.description}</span>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}

function Fact({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      <span className={mono ? ops.mono : styles.factValue}>{children}</span>
    </div>
  )
}
