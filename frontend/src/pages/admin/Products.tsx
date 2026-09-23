import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { ad } from '../../lib/admin'
import type { AdminProduct } from '../../lib/admin'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

const PAGE_SIZE = 25

function formatMoneyPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

export default function Products() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [active, setActive] = useState('ALL')
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<AdminProduct[]>([])
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
        if (active !== 'ALL') params.set('active', active === 'ACTIVE' ? 'true' : 'false')
        const data = await ad<{ products: AdminProduct[]; total: number }>(`/products?${params.toString()}`)
        if (!cancelled) {
          setRows(data.products)
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
  }, [active, debouncedQuery, offset, attempt])

  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)

  return (
    <div className={styles.page}>
      <PageHead kicker="Admin" title="Products" lede="Catalogue, pricing, stock and category assignment." />

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search size={15} aria-hidden="true" />
          <label className={styles.searchLabel} htmlFor="products-search">
            Search by name or SKU
          </label>
          <input
            id="products-search"
            className={styles.searchInput}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or SKU…"
            autoComplete="off"
          />
        </div>
        <label className={styles.filterWrap}>
          <span className={styles.filterLabel}>Status</span>
          <select
            className={styles.filterSelect}
            value={active}
            onChange={(event) => {
              setActive(event.target.value)
              setOffset(0)
            }}
            aria-label="Filter products by status"
          >
            <option value="ALL">All</option>
            <option value="ACTIVE">Active</option>
            <option value="DISABLED">Disabled</option>
          </select>
        </label>
      </div>

      {loading ? (
        <LoadingState label="Loading products…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
      ) : rows.length === 0 ? (
        <EmptyState title="No products" body="No products match these filters." />
      ) : (
        <>
          <div className={ops.tableWrap}>
            <table className={ops.table}>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Price</th>
                  <th scope="col">Stock</th>
                  <th scope="col">Category</th>
                  <th scope="col">Status</th>
                  <th scope="col">Open</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link to={`/admin/products/${row.id}`}>{row.name}</Link>
                      <div className={ops.muted}>{row.sku}</div>
                    </td>
                    <td className={ops.mono}>{formatMoneyPaise(row.price_paise)}</td>
                    <td className={ops.mono}>{row.stock}</td>
                    <td>{row.category_name ?? '—'}</td>
                    <td>
                      <StatusBadge tone={row.active === 1 ? 'ok' : 'bad'}>
                        {row.active === 1 ? 'Active' : 'Disabled'}
                      </StatusBadge>
                    </td>
                    <td className={ops.mono}>
                      {(row.open_orders ?? 0) + (row.open_returns ?? 0) === 0
                        ? '—'
                        : `${row.open_orders ?? 0} ord · ${row.open_returns ?? 0} ret`}
                    </td>
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
