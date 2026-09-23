import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { ad } from '../../lib/admin'
import type { AdminRefund } from '../../lib/admin'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge, statusTone } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

const PAGE_SIZE = 25
const STATUSES = ['ALL', 'PENDING', 'COMPLETED', 'CANCELLED'] as const
const KINDS = ['ALL', 'REFUND', 'REPLACEMENT', 'EXCHANGE', 'STORE_CREDIT'] as const

function formatMoneyPaise(paise: number | null): string {
  if (paise === null) return '—'
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

export default function Refunds() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [status, setStatus] = useState('ALL')
  const [kind, setKind] = useState('ALL')
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<AdminRefund[]>([])
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
        if (kind !== 'ALL') params.set('kind', kind)
        const data = await ad<{ refunds: AdminRefund[]; total: number }>(`/refunds?${params.toString()}`)
        if (!cancelled) {
          setRows(data.refunds)
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
  }, [status, kind, debouncedQuery, offset, attempt])

  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Admin"
        title="Refunds"
        lede="Every refund with its return linkage. State changes belong to the resolve engine — this screen observes."
      />

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search size={15} aria-hidden="true" />
          <label className={styles.searchLabel} htmlFor="refunds-search">
            Search by return, order or customer
          </label>
          <input
            id="refunds-search"
            className={styles.searchInput}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Return, order, customer…"
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
            aria-label="Filter refunds by status"
          >
            {STATUSES.map((option) => (
              <option key={option} value={option}>
                {option === 'ALL' ? 'All statuses' : option.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterWrap}>
          <span className={styles.filterLabel}>Kind</span>
          <select
            className={styles.filterSelect}
            value={kind}
            onChange={(event) => {
              setKind(event.target.value)
              setOffset(0)
            }}
            aria-label="Filter refunds by kind"
          >
            {KINDS.map((option) => (
              <option key={option} value={option}>
                {option === 'ALL' ? 'All kinds' : option.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <LoadingState label="Loading refunds…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
      ) : rows.length === 0 ? (
        <EmptyState title="No refunds" body="No refunds match these filters." />
      ) : (
        <>
          <div className={ops.tableWrap}>
            <table className={ops.table}>
              <thead>
                <tr>
                  <th scope="col">Return</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                  <th scope="col">Initiated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className={ops.mono}>{row.return_number}</td>
                    <td className={ops.mono}>{row.customer_email}</td>
                    <td className={ops.mono}>{row.kind.replaceAll('_', ' ')}</td>
                    <td className={ops.mono}>{formatMoneyPaise(row.amount_paise)}</td>
                    <td>
                      <StatusBadge tone={statusTone(row.status)}>{row.status.replaceAll('_', ' ')}</StatusBadge>
                    </td>
                    <td className={ops.mono}>{formatDate(row.initiated_at)}</td>
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
