import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ad } from '../../lib/admin'
import type { AdminCategory, AdminProduct } from '../../lib/admin'
import { ErrorState, LoadingState, PageHead, StatusBadge } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

function formatMoneyPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

interface Detail {
  product: AdminProduct;
  buckets: Array<{ warehouse_id: string; state: string; quantity: number }>;
  movements: Array<{ id: string; reason: string; quantity: number; created_at: string }>;
  openOrders: Array<{ order_number: string; status: string }>;
  openReturns: Array<{ return_number: string; status: string }>;
}

export default function ProductDetail() {
  const { id } = useParams()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState(false)

  const [name, setName] = useState('')
  const [priceRupees, setPriceRupees] = useState('')
  const [stock, setStock] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')

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
      const [data, cats] = await Promise.all([
        ad<Detail>(`/products/${id}`, { signal }),
        ad<{ categories: AdminCategory[] }>('/categories', { signal }),
      ])
      setDetail(data)
      setCategories(cats.categories.filter((category) => category.active === 1))
      setName(data.product.name)
      setPriceRupees(String(data.product.price_paise / 100))
      setStock(String(data.product.stock))
      setCategoryId(data.product.category_id ?? '')
      setDescription(data.product.description)
      setSaved(false)
      setConfirmDisable(false)
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

  async function submit(patch: Record<string, unknown>): Promise<boolean> {
    if (!id) return false
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      await ad(`/products/${id}`, { method: 'PATCH', body: patch })
      await load()
      setSaved(true)
      return true
    } catch (err) {
      setSaveError(friendlyMessage(err))
      return false
    } finally {
      setSaving(false)
    }
  }

  function submitForm(event: FormEvent): void {
    event.preventDefault()
    const price = Math.round(Number(priceRupees) * 100)
    const stockValue = Number(stock)
    if (!Number.isFinite(price) || price < 0 || !Number.isInteger(stockValue) || stockValue < 0) {
      setSaveError('Price and stock must be non-negative numbers (stock whole units).')
      return
    }
    void submit({
      name: name.trim(),
      pricePaise: price,
      stock: stockValue,
      categoryId: categoryId === '' ? null : categoryId,
      description,
    })
  }

  if (loading) {
    return (
      <div>
        <PageHead kicker="Admin" title="Product" lede="Loading the product file." />
        <LoadingState label="Loading product…" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div>
        <PageHead kicker="Admin" title="Product" lede="Check the link and try again." />
        <ErrorState message="Product not found." />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div>
        <PageHead kicker="Admin" title="Product" lede="Check the link and try again." />
        <ErrorState message={error ?? 'Product could not be loaded.'} onRetry={() => setAttempt((v) => v + 1)} />
      </div>
    )
  }

  const { product } = detail
  const active = product.active === 1

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Admin"
        title={product.name}
        lede={`${product.sku} · ${formatMoneyPaise(product.price_paise)}`}
        actions={<Link to="/admin/products">Back to products</Link>}
      />

      <section className={ops.panel} aria-label="Status">
        <div className={styles.factGrid}>
          <Fact label="Status">
            <StatusBadge tone={active ? 'ok' : 'bad'}>{active ? 'Active' : 'Disabled'}</StatusBadge>
          </Fact>
          <Fact label="Category" mono>
            {product.category_name ?? 'Uncategorised'}
          </Fact>
          <Fact label="Open orders" mono>
            {detail.openOrders.length}
          </Fact>
          <Fact label="Open returns" mono>
            {detail.openReturns.length}
          </Fact>
        </div>
        {saveError && (
          <p className={styles.inlineError} role="alert">
            {saveError}
          </p>
        )}
        {saved && (
          <p className={styles.inlineOk} role="status">
            Saved.
          </p>
        )}
        {!confirmDisable ? (
          <div className={ops.btnRow}>
            <button type="button" className={ops.btn} disabled={saving} onClick={() => setConfirmDisable(true)}>
              {active ? 'Disable product' : 'Enable product'}
            </button>
          </div>
        ) : (
          <div className={ops.btnRow} role="group" aria-label="Confirm product status change">
            <span>
              {active
                ? detail.openOrders.length + detail.openReturns.length > 0
                  ? 'This product has open transactions — disabling will be refused and will name them.'
                  : 'Disable this product? It will disappear from the store.'
                : 'Enable this product? It will return to the store.'}
            </span>
            <button
              type="button"
              className={`${ops.btn} ${ops.btnPrimary}`}
              disabled={saving}
              onClick={() => void submit({ active: !active }).then((ok) => ok && setConfirmDisable(false))}
            >
              {saving ? 'Saving…' : 'Confirm'}
            </button>
            <button type="button" className={ops.btn} disabled={saving} onClick={() => setConfirmDisable(false)}>
              Cancel
            </button>
          </div>
        )}
      </section>

      <section className={ops.panel} aria-label="Edit product">
        <h2 className={ops.panelTitle}>Edit</h2>
        <form onSubmit={submitForm}>
          <div className={ops.formGrid}>
            <label className={ops.field}>
              <span className={ops.label}>Name</span>
              <input className={ops.input} value={name} onChange={(event) => setName(event.target.value)} maxLength={200} />
            </label>
            <label className={ops.field}>
              <span className={ops.label}>Category</span>
              <select className={ops.select} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                <option value="">Uncategorised</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={ops.field}>
              <span className={ops.label}>Price (₹)</span>
              <input
                className={ops.input}
                type="number"
                min={0}
                step="0.01"
                value={priceRupees}
                onChange={(event) => setPriceRupees(event.target.value)}
              />
            </label>
            <label className={ops.field}>
              <span className={ops.label}>Stock (mirrors sellable bucket)</span>
              <input
                className={ops.input}
                type="number"
                min={0}
                step={1}
                value={stock}
                onChange={(event) => setStock(event.target.value)}
              />
            </label>
            <label className={`${ops.field} ${ops.fieldFull}`}>
              <span className={ops.label}>Description</span>
              <textarea className={ops.textarea} value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={4000} />
            </label>
          </div>
          <div className={ops.btnRow}>
            <button type="submit" className={`${ops.btn} ${ops.btnPrimary}`} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </section>

      <section className={ops.panel} aria-label="Stock distribution">
        <h2 className={ops.panelTitle}>Buckets ({detail.buckets.length})</h2>
        {detail.buckets.length === 0 ? (
          <p className={ops.muted}>No bucket rows.</p>
        ) : (
          <ul className={styles.plainList}>
            {detail.buckets.map((bucket, index) => (
              <li key={`${bucket.warehouse_id}-${bucket.state}-${index}`}>
                <span className={ops.mono}>
                  {bucket.warehouse_id} · {bucket.state.replaceAll('_', ' ')}: {bucket.quantity}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
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
