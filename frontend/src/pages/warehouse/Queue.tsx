import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { wh, WORKABLE_STATUSES } from '../../lib/warehouse'
import type { QueueRow } from '../../lib/warehouse'
import { productImageFor } from '../../lib/productImage'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge, statusTone } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from './ops.module.css'
import styles from './queue.module.css'

const PAGE_SIZE = 25
// REQUESTED first: brand-new returns need approval, and the default
// workable-only view hides them. The API matches any exact status.
const STATUS_OPTIONS = ['ALL', 'REQUESTED', ...WORKABLE_STATUSES, 'RESOLVED', 'CANCELLED'] as const

function formatAge(ageHours: number): string {
  if (!Number.isFinite(ageHours) || ageHours < 0) return '—'
  if (ageHours < 24) return `${Math.floor(ageHours)}h`
  return `${Math.floor(ageHours / 24)}d`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function priorityClass(priority: string): string {
  if (priority === 'URGENT') return ops.priUrgent
  if (priority === 'HIGH') return ops.priHigh
  if (priority === 'NORMAL') return ops.priNormal
  return ops.priLow
}

export default function ReturnQueue() {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<string>(() => searchParams.get('status') ?? 'ALL')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<QueueRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  // Debounce the server-side search so every keystroke is not a request.
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
        const params = new URLSearchParams({
          status,
          limit: String(PAGE_SIZE),
          offset: String(offset),
        })
        if (debouncedQuery !== '') params.set('search', debouncedQuery)
        const data = await wh<{ returns: QueueRow[]; total: number }>(`/returns?${params.toString()}`)
        if (!cancelled) {
          setRows(data.returns)
          setTotal(data.total)
        }
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 403) {
            setError('This account is not assigned to a warehouse.')
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

  function changeStatus(next: string): void {
    setStatus(next)
    setOffset(0)
  }

  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Floor"
        title="Return queue"
        lede="Oldest first. Priority and SLA are derived live — nothing here is stored."
      />

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search size={15} aria-hidden="true" className={styles.searchIcon} />
          <label className={styles.searchLabel} htmlFor="queue-search">
            Search by return, order, tracking, SKU or product
          </label>
          <input
            id="queue-search"
            className={styles.searchInput}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Return, order, tracking, SKU, product…"
            autoComplete="off"
          />
        </div>
        <label className={styles.statusWrap}>
          <span className={styles.statusLabel}>Status</span>
          <select
            className={styles.statusSelect}
            value={status}
            onChange={(event) => changeStatus(event.target.value)}
            aria-label="Filter queue by status"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === 'ALL' ? 'All workable' : option.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <LoadingState label="Loading the queue…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Queue is clear"
          body={debouncedQuery !== '' || status !== 'ALL'
            ? 'No returns match this filter.'
            : 'No returns need floor work right now.'}
        />
      ) : (
        <>
          <div className={ops.tableWrap}>
            <table className={ops.table}>
              <thead>
                <tr>
                  <th scope="col">Return</th>
                  <th scope="col">Product</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Status</th>
                  <th scope="col">Pri</th>
                  <th scope="col">Age</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.returnId}>
                    <td>
                      <Link className={ops.mono} to={`/warehouse/returns/${row.returnId}`}>
                        {row.returnNumber}
                      </Link>
                      <div className={`${ops.muted} ${ops.mono}`}>{row.orderNumber ?? row.orderId}</div>
                    </td>
                    <td>
                      <span className={styles.productCell}>
                        <img
                          className={styles.thumb}
                          src={productImageFor({ imageUrl: row.imageUrl, name: row.productName, sku: row.sku })}
                          alt=""
                          aria-hidden="true"
                          loading="lazy"
                        />
                        <span>
                          <span className={styles.productName}>{row.productName ?? '—'}</span>
                          <span className={styles.productSub}>
                            {row.sku ?? ''}
                            {row.lineCount > 1 ? ` · +${row.lineCount - 1} lines` : ''}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className={ops.mono}>{row.quantity}</td>
                    <td className={ops.mono}>{row.reasonCode ?? '—'}</td>
                    <td>
                      <StatusBadge tone={statusTone(row.status)}>{row.status.replaceAll('_', ' ')}</StatusBadge>
                    </td>
                    <td>
                      <span className={`${ops.pri} ${priorityClass(row.priority)}`}>{row.priority}</span>
                      {row.overdue && (
                        <>
                          {' '}
                          <span className={ops.flagOverdue}>OVERDUE</span>
                        </>
                      )}
                    </td>
                    <td className={ops.mono}>{formatAge(row.ageHours)}</td>
                    <td className={ops.mono}>{formatDate(row.updatedAt)}</td>
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
