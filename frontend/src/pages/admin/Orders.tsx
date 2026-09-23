import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { ad } from '../../lib/admin'
import type { AdminOrder } from '../../lib/admin'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge, statusTone } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

const PAGE_SIZE = 25
const STATUSES = ['ALL', 'PLACED', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'] as const

function formatMoneyPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

export default function Orders() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [status, setStatus] = useState('ALL')
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<AdminOrder[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
      setOffset(0)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
        if (debouncedQuery !== '') params.set('search', debouncedQuery)
        if (status !== 'ALL') params.set('status', status)
        const data = await ad<{ orders: AdminOrder[]; total: number }>(`/orders?${params.toString()}`)
        if (!cancelled) {
          setRows(data.orders)
          setTotal(data.total)
        }
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 403) {
            setError('This account is not an admin.')
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
  }, [status, debouncedQuery, offset, attempt])

  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)

  return (
    <div className={styles.page}>
      <PageHead kicker="Admin" title="Orders" lede="Every order, every customer, with payment and shipment state." />

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search size={15} aria-hidden="true" />
          <label className={styles.searchLabel} htmlFor="orders-search">
            Search by number, customer, SKU or product
          </label>
          <input
            id="orders-search"
            className={styles.searchInput}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Order, customer, SKU, product…"
            autoComplete="off"
          />
        </div>
        <label className={styles.filterWrap}>
          <span className={styles.filterLabel}>Status</span>
          <select
            className={styles.filterSelect}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              setOffset(0)
            }}
            aria-label="Filter orders by status"
          >
            {STATUSES.map((option) => (
              <option key={option} value={option}>
                {option === 'ALL' ? 'All statuses' : option.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <LoadingState label="Loading orders…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
      ) : rows.length === 0 ? (
        <EmptyState title="No orders" body="No orders match these filters." />
      ) : (
        <>
          <div className={ops.tableWrap}>
            <table className={ops.table}>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Items</th>
                  <th scope="col">Total</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Status</th>
                  <th scope="col">Placed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link className={ops.mono} to={`/admin/orders/${row.id}`}>
                        {row.order_number}
                      </Link>
                      <div className={`${ops.muted} ${ops.mono}`}>{row.tracking_number ?? ''}</div>
                    </td>
                    <td>
                      <Link to={`/admin/customers/${row.customer_id}`}>{row.customer_name}</Link>
                      <div className={ops.muted}>{row.customer_email}</div>
                    </td>
                    <td className={ops.mono}>{row.items_count}</td>
                    <td className={ops.mono}>{formatMoneyPaise(row.subtotal_paise)}</td>
                    <td className={ops.mono}>{row.payment_status ?? '—'}</td>
                    <td>
                      <StatusBadge tone={statusTone(row.status)}>{row.status.replaceAll('_', ' ')}</StatusBadge>
                    </td>
                    <td className={ops.mono}>{formatDate(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.pager}>
            <span className={ops.muted} role="status">
              Showing {from}–{to} of {total}
            </span>
            <span className={styles.pagerBtns}>
              <button
                type="button"
                className={styles.pagerBtn}
                disabled={offset === 0}
                onClick={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
              >
                ← Prev
              </button>
              <button
                type="button"
                className={styles.pagerBtn}
                disabled={to >= total}
                onClick={() => setOffset((v) => v + PAGE_SIZE)}
              >
                Next →
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  )
}
