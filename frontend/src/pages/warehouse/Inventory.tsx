import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { wh } from '../../lib/warehouse'
import type { InventoryLine, InventoryMovement } from '../../lib/warehouse'
import { productImageFor } from '../../lib/productImage'
import { EmptyState, ErrorState, LoadingState, PageHead } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from './ops.module.css'
import styles from './inventory.module.css'

const PAGE_SIZE = 25

/* Display-only mirror of the backend movement reasons. Re-validated server-side. */
const MOVEMENT_REASONS = [
  'RETURN_RECEIVED',
  'INSPECTION_STARTED',
  'INSPECTION_COMPLETED',
  'RESTOCK',
  'DAMAGE',
  'REPAIR',
  'RESALE',
  'VENDOR_RETURN',
  'RECYCLE',
  'DISPOSAL',
  'ADJUSTMENT',
] as const

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function stateEntries(states: Record<string, number>): Array<[string, number]> {
  return Object.entries(states)
    .filter(([state, qty]) => state === 'AVAILABLE' || qty !== 0)
    .sort(([a], [b]) => (a === 'AVAILABLE' ? -1 : b === 'AVAILABLE' ? 1 : a.localeCompare(b)))
}

export default function Inventory() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [lines, setLines] = useState<InventoryLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const [productFilter, setProductFilter] = useState('')
  const [reasonFilter, setReasonFilter] = useState('')
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [movTotal, setMovTotal] = useState(0)
  const [movOffset, setMovOffset] = useState(0)
  const [movLoading, setMovLoading] = useState(true)
  const [movError, setMovError] = useState<string | null>(null)
  const [movAttempt, setMovAttempt] = useState(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 400)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        if (debouncedQuery !== '') params.set('search', debouncedQuery)
        const data = await wh<{ inventory: InventoryLine[]; total: number }>(`/inventory?${params.toString()}`)
        if (!cancelled) setLines(data.inventory)
      } catch (err) {
        if (!cancelled) setError(forbiddenMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, attempt])

  useEffect(() => {
    let cancelled = false
    async function loadMovements(): Promise<void> {
      setMovLoading(true)
      setMovError(null)
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(movOffset) })
        if (productFilter !== '') params.set('productId', productFilter)
        if (reasonFilter !== '') params.set('reason', reasonFilter)
        const data = await wh<{ movements: InventoryMovement[]; total: number }>(
          `/inventory-movements?${params.toString()}`,
        )
        if (!cancelled) {
          setMovements(data.movements)
          setMovTotal(data.total)
        }
      } catch (err) {
        if (!cancelled) setMovError(forbiddenMessage(err))
      } finally {
        if (!cancelled) setMovLoading(false)
      }
    }
    void loadMovements()
    return () => {
      cancelled = true
    }
  }, [productFilter, reasonFilter, movOffset, movAttempt])

  const productOptions = useMemo(() => lines.map((line) => ({ id: line.productId, name: line.name })), [lines])
  const movFrom = movTotal === 0 ? 0 : movOffset + 1
  const movTo = Math.min(movOffset + PAGE_SIZE, movTotal)

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Floor"
        title="Inventory"
        lede="Sellable stock mirrors the AVAILABLE bucket. Everything else is physically here but not sellable."
      />

      <section className={ops.panel} aria-label="Stock by product">
        <h2 className={ops.panelTitle}>Stock by product</h2>
        <div className={styles.search}>
          <Search size={15} aria-hidden="true" className={styles.searchIcon} />
          <label className={styles.searchLabel} htmlFor="inventory-search">Search products</label>
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
        {loading ? (
          <LoadingState label="Loading inventory…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
        ) : lines.length === 0 ? (
          <EmptyState title="No products" body="No products match this search." />
        ) : (
          <div className={ops.tableWrap}>
            <table className={ops.table}>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Sellable</th>
                  <th scope="col">Buckets</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.productId}>
                    <td>
                      <span className={styles.productCell}>
                        <img
                          className={styles.thumb}
                          src={productImageFor({ imageUrl: line.imageUrl, name: line.name, sku: line.sku })}
                          alt=""
                          aria-hidden="true"
                          loading="lazy"
                        />
                        <span>
                          <span className={styles.productName}>{line.name}</span>
                          <span className={styles.productSub}>{line.sku}</span>
                        </span>
                      </span>
                    </td>
                    <td className={`${ops.mono} ${styles.sellable}`}>
                      <strong>{line.sellableStock}</strong>
                    </td>
                    <td>
                      <span className={styles.buckets}>
                        {stateEntries(line.states).map(([state, qty]) => (
                          <span key={state} className={`${styles.bucket} ${state === 'AVAILABLE' ? styles.bucketSellable : ''}`}>
                            {state.replaceAll('_', ' ')} {qty}
                          </span>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={ops.panel} aria-label="Movement history">
        <h2 className={ops.panelTitle}>Movements</h2>
        <div className={styles.movementFilters}>
          <label className={styles.filterWrap}>
            <span className={styles.filterLabel}>Product</span>
            <select
              className={styles.filterSelect}
              value={productFilter}
              onChange={(event) => {
                setProductFilter(event.target.value)
                setMovOffset(0)
              }}
              aria-label="Filter movements by product"
            >
              <option value="">All products</option>
              {productOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.filterWrap}>
            <span className={styles.filterLabel}>Reason</span>
            <select
              className={styles.filterSelect}
              value={reasonFilter}
              onChange={(event) => {
                setReasonFilter(event.target.value)
                setMovOffset(0)
              }}
              aria-label="Filter movements by reason"
            >
              <option value="">All reasons</option>
              {MOVEMENT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
        </div>
        {movLoading ? (
          <LoadingState label="Loading movements…" />
        ) : movError ? (
          <ErrorState message={movError} onRetry={() => setMovAttempt((v) => v + 1)} />
        ) : movements.length === 0 ? (
          <EmptyState title="No movements" body="No stock movements match these filters." />
        ) : (
          <>
            <div className={ops.tableWrap}>
              <table className={ops.table}>
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">SKU</th>
                    <th scope="col">Qty</th>
                    <th scope="col">From → To</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((movement) => (
                    <tr key={movement.id}>
                      <td className={ops.mono}>{formatDate(movement.created_at)}</td>
                      <td className={ops.mono}>{movement.sku}</td>
                      <td className={ops.mono}>{movement.quantity}</td>
                      <td className={ops.mono}>
                        {(movement.from_state ?? '—').replaceAll('_', ' ')} → {(movement.to_state ?? '—').replaceAll('_', ' ')}
                      </td>
                      <td className={ops.mono}>{movement.reason.replaceAll('_', ' ')}</td>
                      <td className={ops.mono}>
                        {movement.reference_type === 'RETURN' ? (
                          <Link to={`/warehouse/returns/${movement.reference_id}`}>{movement.reference_id.slice(0, 8)}…</Link>
                        ) : (
                          `${movement.reference_type} ${movement.reference_id.slice(0, 8)}…`
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.pager}>
              <span className={ops.muted} role="status">
                Showing {movFrom}–{movTo} of {movTotal}
              </span>
              <span className={styles.pagerBtns}>
                <button
                  type="button"
                  className={styles.pagerBtn}
                  disabled={movOffset === 0}
                  onClick={() => setMovOffset((v) => Math.max(0, v - PAGE_SIZE))}
                >
                  ← Prev
                </button>
                <button
                  type="button"
                  className={styles.pagerBtn}
                  disabled={movTo >= movTotal}
                  onClick={() => setMovOffset((v) => v + PAGE_SIZE)}
                >
                  Next →
                </button>
              </span>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function forbiddenMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) {
    return 'This account is not assigned to a warehouse.'
  }
  return friendlyMessage(err)
}
