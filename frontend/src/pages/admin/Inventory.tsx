import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { ad } from '../../lib/admin'
import type { AdminInventoryLine } from '../../lib/admin'
import { productImageFor } from '../../lib/productImage'
import { EmptyState, ErrorState, LoadingState, PageHead } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

const PAGE_SIZE = 25

export default function Inventory() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<AdminInventoryLine[]>([])
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
        const data = await ad<{ inventory: AdminInventoryLine[]; total: number }>(`/inventory?${params.toString()}`)
        if (!cancelled) {
          setRows(data.inventory)
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
  }, [debouncedQuery, offset, attempt])

  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)

  return (
    <div className={styles.page}>
      <PageHead kicker="Admin" title="Inventory" lede="Global stock: sellable mirror plus every site's buckets." />

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search size={15} aria-hidden="true" />
          <label className={styles.searchLabel} htmlFor="inventory-search">
            Search products
          </label>
          <input
            id="inventory-search"
            className={styles.searchInput}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or SKU…"
            autoComplete="off"
          />
        </div>
      </div>

      {loading ? (
        <LoadingState label="Loading inventory…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
      ) : rows.length === 0 ? (
        <EmptyState title="No products" body="No products match this search." />
      ) : (
        <>
          <div className={ops.tableWrap}>
            <table className={ops.table}>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Sellable</th>
                  <th scope="col">Buckets by site</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.product_id}>
                    <td>
                      <span className={styles.productCell}>
                        <img
                          className={styles.thumb}
                          src={productImageFor({ imageUrl: row.image_url, name: row.name, sku: row.sku })}
                          alt=""
                          aria-hidden="true"
                          loading="lazy"
                        />
                        <span>
                          <span className={styles.productName}>{row.name}</span>
                          <span className={styles.productSub}>{row.sku}</span>
                        </span>
                      </span>
                    </td>
                    <td className={ops.mono}>
                      <strong>{row.sellable_stock}</strong>
                    </td>
                    <td>
                      {row.buckets.length === 0 ? (
                        <span className={ops.muted}>—</span>
                      ) : (
                        <span className={styles.buckets}>
                          {row.buckets.map((bucket, index) => (
                            <span key={`${bucket.warehouse_id}-${bucket.state}-${index}`} className={styles.bucket}>
                              {bucket.warehouse_code ?? bucket.warehouse_id} · {bucket.state.replaceAll('_', ' ')}{' '}
                              {bucket.quantity}
                            </span>
                          ))}
                        </span>
                      )}
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
