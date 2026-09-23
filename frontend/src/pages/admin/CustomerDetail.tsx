import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ad } from '../../lib/admin'
import type { AdminCustomerDetail } from '../../lib/admin'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge, statusTone } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import { CustomerStatus } from './Customers'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

function formatMoneyPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

export default function CustomerDetail() {
  const { id } = useParams()
  const [detail, setDetail] = useState<AdminCustomerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)

  async function load(signal?: AbortSignal): Promise<void> {
    if (!id) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    setNotFound(false)
    try {
      const data = await ad<AdminCustomerDetail>(`/customers/${id}`, { signal })
      setDetail(data)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true)
      } else if ((err as Error).name !== 'AbortError') {
        setError(friendlyMessage(err))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attempt])

  async function setActive(active: boolean): Promise<void> {
    if (!id) return
    setMutating(true)
    setMutationError(null)
    try {
      await ad(`/customers/${id}`, { method: 'PATCH', body: { active } })
      setConfirming(false)
      await load()
    } catch (err) {
      setMutationError(friendlyMessage(err))
    } finally {
      setMutating(false)
    }
  }

  if (loading) {
    return (
      <div>
        <PageHead kicker="Admin" title="Customer" lede="Loading the customer file." />
        <LoadingState label="Loading customer…" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div>
        <PageHead kicker="Admin" title="Customer" lede="Check the link and try again." />
        <ErrorState message="Customer not found." />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div>
        <PageHead kicker="Admin" title="Customer" lede="Check the link and try again." />
        <ErrorState message={error ?? 'Customer could not be loaded.'} onRetry={() => setAttempt((v) => v + 1)} />
      </div>
    )
  }

  const { user } = detail
  const disabled = user.active === 0

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Admin"
        title={user.full_name}
        lede={`${user.email} · joined ${formatDate(user.created_at)}`}
        actions={<Link to="/admin/customers">Back to customers</Link>}
      />

      <section className={ops.panel} aria-label="Account">
        <h2 className={ops.panelTitle}>Account</h2>
        <div className={styles.factGrid}>
          <Fact label="Status">
            <CustomerStatus active={user.active} />
          </Fact>
          <Fact label="Phone" mono>
            {user.phone ?? '—'}
          </Fact>
          <Fact label="Credit balance" mono>
            {formatMoneyPaise(detail.credit.balancePaise)}
          </Fact>
          <Fact label="Orders" mono>
            {detail.orders.length}
          </Fact>
          <Fact label="Returns" mono>
            {detail.returns.length}
          </Fact>
        </div>
        {mutationError && (
          <p className={styles.inlineError} role="alert">
            {mutationError}
          </p>
        )}
        {!confirming ? (
          <div className={ops.btnRow}>
            <button
              type="button"
              className={ops.btn}
              disabled={mutating}
              onClick={() => setConfirming(true)}
            >
              {disabled ? 'Enable account' : 'Disable account'}
            </button>
          </div>
        ) : (
          <div className={ops.btnRow} role="group" aria-label="Confirm account status change">
            <span>
              {disabled
                ? 'Re-enable this account?'
                : 'Disable this account? Open orders and returns keep resolving; only future access stops.'}
            </span>
            <button
              type="button"
              className={`${ops.btn} ${ops.btnPrimary}`}
              disabled={mutating}
              onClick={() => void setActive(!disabled)}
            >
              {mutating ? 'Saving…' : 'Confirm'}
            </button>
            <button type="button" className={ops.btn} disabled={mutating} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        )}
      </section>

      <section className={ops.panel} aria-label="Orders">
        <h2 className={ops.panelTitle}>Orders ({detail.orders.length})</h2>
        {detail.orders.length === 0 ? (
          <EmptyState title="No orders" body="This customer has not placed any orders." />
        ) : (
          <div className={ops.tableWrap}>
            <table className={ops.table}>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Status</th>
                  <th scope="col">Subtotal</th>
                  <th scope="col">Placed</th>
                </tr>
              </thead>
              <tbody>
                {detail.orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link className={ops.mono} to={`/admin/orders/${order.id}`}>
                        {order.order_number}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge tone={statusTone(order.status)}>{order.status.replaceAll('_', ' ')}</StatusBadge>
                    </td>
                    <td className={ops.mono}>{formatMoneyPaise(order.subtotal_paise)}</td>
                    <td className={ops.mono}>{formatDate(order.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={ops.panel} aria-label="Returns">
        <h2 className={ops.panelTitle}>Returns ({detail.returns.length})</h2>
        {detail.returns.length === 0 ? (
          <EmptyState title="No returns" body="No return requests from this customer." />
        ) : (
          <div className={ops.tableWrap}>
            <table className={ops.table}>
              <thead>
                <tr>
                  <th scope="col">Return</th>
                  <th scope="col">Status</th>
                  <th scope="col">Resolution</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {detail.returns.map((ret) => (
                  <tr key={ret.id}>
                    <td>
                      <Link className={ops.mono} to={`/admin/returns/${ret.id}`}>
                        {ret.return_number}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge tone={statusTone(ret.status)}>{ret.status.replaceAll('_', ' ')}</StatusBadge>
                    </td>
                    <td className={ops.mono}>{ret.resolution_type?.replaceAll('_', ' ') ?? '—'}</td>
                    <td className={ops.mono}>{formatDate(ret.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className={styles.twoCol}>
        <section className={ops.panel} aria-label="Financial">
          <h2 className={ops.panelTitle}>Financial</h2>
          <h3 className={styles.subTitle}>Refunds ({detail.refunds.length})</h3>
          {detail.refunds.length === 0 ? (
            <p className={ops.muted}>No refunds.</p>
          ) : (
            <ul className={styles.plainList}>
              {detail.refunds.map((refund) => (
                <li key={refund.id}>
                  <span className={ops.mono}>
                    {formatMoneyPaise(refund.amount_paise)} · {refund.status.replaceAll('_', ' ')}
                  </span>{' '}
                  <span className={ops.muted}>{refund.return_number}</span>
                </li>
              ))}
            </ul>
          )}
          <h3 className={styles.subTitle}>Store credit ledger ({detail.credit.history.length})</h3>
          {detail.credit.history.length === 0 ? (
            <p className={ops.muted}>No ledger entries.</p>
          ) : (
            <ul className={styles.plainList}>
              {detail.credit.history.slice(0, 10).map((entry) => (
                <li key={entry.id}>
                  <span className={ops.mono}>
                    {entry.type} {formatMoneyPaise(entry.amount_paise)}
                  </span>{' '}
                  <span className={ops.muted}>{entry.reason ?? entry.reference_type}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={ops.panel} aria-label="Support and activity">
          <h2 className={ops.panelTitle}>Support ({detail.tickets.length})</h2>
          {detail.tickets.length === 0 ? (
            <p className={ops.muted}>No tickets.</p>
          ) : (
            <ul className={styles.plainList}>
              {detail.tickets.map((ticket) => (
                <li key={ticket.id}>
                  <Link to={`/admin/support/${ticket.id}`}>{ticket.ticket_number}</Link>{' '}
                  <span className={ops.muted}>
                    {ticket.subject} · {ticket.status.replaceAll('_', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h3 className={styles.subTitle}>Activity</h3>
          {detail.activity.length === 0 ? (
            <p className={ops.muted}>No recorded activity.</p>
          ) : (
            <ul className={styles.plainList}>
              {detail.activity.map((event, index) => (
                <li key={`${event.kind}-${event.created_at}-${index}`}>
                  <span className={ops.mono}>{event.status.replaceAll('_', ' ')}</span>{' '}
                  <span className={ops.muted}>
                    {event.kind} · {formatDate(event.created_at)}
                  </span>
                </li>
              ))}
            </ul>
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
