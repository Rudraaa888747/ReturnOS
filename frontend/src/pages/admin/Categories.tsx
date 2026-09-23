import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ad } from '../../lib/admin'
import type { AdminCategory } from '../../lib/admin'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

export default function Categories() {
  const [rows, setRows] = useState<AdminCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  async function load(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const data = await ad<{ categories: AdminCategory[] }>('/categories')
      setRows(data.categories)
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError('This account is not an admin.')
      } else {
        setError(friendlyMessage(err))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!cancelled) await load()
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (name.trim() === '') {
      setFormError('Category name is required.')
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      await ad('/categories', { method: 'POST', body: { name: name.trim(), description: description.trim() === '' ? null : description.trim() } })
      setName('')
      setDescription('')
      await load()
    } catch (err) {
      setFormError(friendlyMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(category: AdminCategory): Promise<void> {
    setBusy(true)
    setFormError(null)
    try {
      await ad(`/categories/${category.id}`, { method: 'PATCH', body: { active: category.active !== 1 } })
      await load()
    } catch (err) {
      setFormError(friendlyMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(category: AdminCategory): Promise<void> {
    if (!window.confirm(`Delete category "${category.name}"? Only empty categories can be deleted.`)) return
    setBusy(true)
    setFormError(null)
    try {
      await ad(`/categories/${category.id}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setFormError(friendlyMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <PageHead kicker="Admin" title="Categories" lede="Catalogue grouping with live product counts. Only empty categories can be deleted." />

      <section className={ops.panel} aria-label="Add category">
        <h2 className={ops.panelTitle}>Add category</h2>
        <form onSubmit={(event) => void create(event)}>
          <div className={ops.formGrid}>
            <label className={ops.field}>
              <span className={ops.label}>Name</span>
              <input className={ops.input} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
            </label>
            <label className={ops.field}>
              <span className={ops.label}>Description (optional)</span>
              <input
                className={ops.input}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
              />
            </label>
          </div>
          {formError && (
            <p className={styles.inlineError} role="alert">
              {formError}
            </p>
          )}
          <div className={ops.btnRow}>
            <button type="submit" className={`${ops.btn} ${ops.btnPrimary}`} disabled={busy}>
              {busy ? 'Saving…' : 'Add category'}
            </button>
          </div>
        </form>
      </section>

      <section className={ops.panel} aria-label="Category list">
        <h2 className={ops.panelTitle}>Categories</h2>
        {loading ? (
          <LoadingState label="Loading categories…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
        ) : rows.length === 0 ? (
          <EmptyState title="No categories" body="Add the first category above." />
        ) : (
          <div className={ops.tableWrap}>
            <table className={ops.table}>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Products</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.name}
                      <div className={ops.muted}>{row.description ?? ''}</div>
                    </td>
                    <td className={ops.mono}>{row.product_count ?? '—'}</td>
                    <td>
                      <StatusBadge tone={row.active === 1 ? 'ok' : 'bad'}>
                        {row.active === 1 ? 'Active' : 'Disabled'}
                      </StatusBadge>
                    </td>
                    <td>
                      <span className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          disabled={busy}
                          onClick={() => void toggle(row)}
                        >
                          {row.active === 1 ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          disabled={busy || (row.product_count ?? 0) > 0}
                          title={(row.product_count ?? 0) > 0 ? 'Categories holding products cannot be deleted' : 'Delete category'}
                          onClick={() => void remove(row)}
                        >
                          Delete
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
