import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { ad } from '../../lib/admin'
import type { AdminReturn } from '../../lib/admin'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge, statusTone } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

const PAGE_SIZE = 25
const STATUSES = ['ALL', 'REQUESTED', 'APPROVED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED', 'INSPECTION', 'RESOLVED', 'CANCELLED'] as const
const RESOLUTIONS = ['ALL', 'REFUND', 'REPLACEMENT', 'EXCHANGE', 'STORE_CREDIT'] as const

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

export default function Returns() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [status, setStatus] = useState('ALL')
  const [resolution, setResolution] = useState('ALL')
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<AdminReturn[]>([])
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
        if (resolution !== 'ALL') params.set('resolution', resolution)
        const data = await ad<{ returns: AdminReturn[]; total: number }>(`/returns?${params.toString()}`)
        if (!cancelled) {
          setRows(data.returns)
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
  }, [status, resolution, debouncedQuery, offset, attempt])

  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)

  return (
    <div className={styles.page}>
      <PageHead kicker="Admin" title="All Returns" lede="The complete return ecosystem across customers and warehouses." />

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search size={15} aria-hidden="true" />
          <label className={styles.searchLabel} htmlFor="returns-search">
            Search by return, order, customer, SKU or product
          </label>
          <input
            id="returns-search"
            className={styles.searchInput}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Return, order, customer, SKU…"
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
            aria-label="Filter returns by status"
          >
            {STATUSES.map((option) => (
              <option key={option} value={option}>
                {option === 'ALL' ? 'All statuses' : option.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterWrap}>
          <span className={styles.filterLabel}>Resolution</span>
          <select
            className={styles.filterSelect}
            value={resolution}
            onChange={(event) => {
              setResolution(event.target.value)
              setOffset(0)
            }}
            aria-label="Filter returns by resolution"
          >
            {RESOLUTIONS.map((option) => (
              <option key={option} value={option}>
                {option === 'ALL' ? 'All resolutions' : option.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <LoadingState label="Loading returns…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
      ) : rows.length === 0 ? (
        <EmptyState title="No returns" body="No returns match these filters." />
      ) : (
        <>
          <div className={ops.tableWrap}>
            <table className={ops.table}>
              <thead>
                <tr>
                  <th scope="col">Return</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Product</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Status</th>
                  <th scope="col">Resolution</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link className={ops.mono} to={`/admin/returns/${row.id}`}>
                        {row.return_number}
                      </Link>
                      <div className={`${ops.muted} ${ops.mono}`}>{row.order_number ?? ''}</div>
                    </td>
                    <td>
                      <Link to={`/admin/customers/${row.customer_id}`}>{row.customer_name}</Link>
                      <div className={ops.muted}>{row.customer_email}</div>
                    </td>
                    <td>
                      {row.product_name ?? '—'}
                      <div className={ops.muted}>{row.sku ?? ''}</div>
                    </td>
                    <td className={ops.mono}>{row.quantity}</td>
                    <td className={ops.mono}>{row.reason_code ?? '—'}</td>
                    <td>
                      <StatusBadge tone={statusTone(row.status)}>{row.status.replaceAll('_', ' ')}</StatusBadge>
                    </td>
                    <td className={ops.mono}>{row.resolution_type?.replaceAll('_', ' ') ?? '—'}</td>
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
