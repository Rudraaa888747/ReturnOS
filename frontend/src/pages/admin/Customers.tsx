import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { ad } from '../../lib/admin'
import type { AdminCustomer } from '../../lib/admin'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

const PAGE_SIZE = 25

function formatMoneyPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}

export default function Customers() {
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('search') ?? '')
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  const [sort, setSort] = useState('created_at')
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<AdminCustomer[]>([])
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
        const params = new URLSearchParams({
          sort,
          dir: 'desc',
          limit: String(PAGE_SIZE),
          offset: String(offset),
        })
        if (debouncedQuery !== '') params.set('search', debouncedQuery)
        const data = await ad<{ customers: AdminCustomer[]; total: number }>(`/customers?${params.toString()}`)
        if (!cancelled) {
          setRows(data.customers)
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
  }, [sort, debouncedQuery, offset, attempt])

  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)

  return (
    <div className={styles.page}>
      <PageHead kicker="Admin" title="Customers" lede="Every customer account with live order, return and credit rollups." />

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search size={15} aria-hidden="true" />
          <label className={styles.searchLabel} htmlFor="customers-search">
            Search by email or name
          </label>
          <input
            id="customers-search"
            className={styles.searchInput}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Email or name…"
            autoComplete="off"
          />
        </div>
        <label className={styles.filterWrap}>
          <span className={styles.filterLabel}>Sort</span>
          <select
            className={styles.filterSelect}
            value={sort}
            onChange={(event) => {
              setSort(event.target.value)
              setOffset(0)
            }}
            aria-label="Sort customers"
          >
            <option value="created_at">Newest</option>
            <option value="full_name">Name</option>
            <option value="email">Email</option>
            <option value="orders">Most orders</option>
            <option value="credit">Highest credit</option>
            <option value="activity">Recent activity</option>
          </select>
        </label>
      </div>

      {loading ? (
        <LoadingState label="Loading customers…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
      ) : rows.length === 0 ? (
        <EmptyState title="No customers" body="No customer accounts match this search." />
      ) : (
        <>
          <div className={ops.tableWrap}>
            <table className={ops.table}>
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Orders</th>
                  <th scope="col">Returns</th>
                  <th scope="col">Credit</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link to={`/admin/customers/${row.id}`}>{row.full_name}</Link>
                      <div className={ops.muted}>{row.email}</div>
                    </td>
                    <td className={ops.mono}>{row.orders_count}</td>
                    <td className={ops.mono}>{row.returns_count}</td>
                    <td className={ops.mono}>{formatMoneyPaise(row.credit_balance_paise)}</td>
                    <td className={ops.mono}>{formatDate(row.created_at)}</td>
                    <td className={ops.mono}>{formatDate(row.last_activity)}</td>
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

export function CustomerStatus({ active }: { active?: number }) {
  if (active === 0) {
    return <StatusBadge tone="bad">Disabled</StatusBadge>
  }
  return <StatusBadge tone="ok">Active</StatusBadge>
}
