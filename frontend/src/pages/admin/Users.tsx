import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Search } from 'lucide-react'
import { ad } from '../../lib/admin'
import type { AdminUserRow } from '../../lib/admin'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

const PAGE_SIZE = 25

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}

export default function Users() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [role, setRole] = useState('WAREHOUSE')
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [sites, setSites] = useState<Array<{ id: string; code: string; name: string }>>([])

  const [opEmail, setOpEmail] = useState('')
  const [opPassword, setOpPassword] = useState('')
  const [opName, setOpName] = useState('')
  const [opSite, setOpSite] = useState('')

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
          role,
          limit: String(PAGE_SIZE),
          offset: String(offset),
        })
        if (debouncedQuery !== '') params.set('search', debouncedQuery)
        const [data, sitesData] = await Promise.all([
          ad<{ users: AdminUserRow[]; total: number }>(`/users?${params.toString()}`),
          role === 'WAREHOUSE'
            ? ad<{ warehouses: Array<{ id: string; code: string; name: string }> }>('/warehouses')
            : Promise.resolve(null),
        ])
        if (!cancelled) {
          setRows(data.users)
          setTotal(data.total)
          if (sitesData && sitesData.warehouses.length > 0) {
            setSites(sitesData.warehouses)
            setOpSite((prev) => prev === '' ? sitesData.warehouses[0].id : prev)
          }
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
  }, [role, debouncedQuery, offset, attempt])

  async function createOperator(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setFormError(null)
    try {
      await ad('/warehouse-users', {
        method: 'POST',
        body: { email: opEmail.trim(), password: opPassword, fullName: opName.trim(), warehouseId: opSite },
      })
      setOpEmail('')
      setOpPassword('')
      setOpName('')
      setAttempt((v) => v + 1)
    } catch (err) {
      setFormError(friendlyMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function toggleOperator(row: AdminUserRow): Promise<void> {
    if (!window.confirm(`${row.active === 1 ? 'Disable' : 'Enable'} operator ${row.email}? Open work blocks a disable by name.`)) {
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      await ad(`/warehouse-users/${row.id}`, { method: 'PATCH', body: { active: row.active !== 1 } })
      setAttempt((v) => v + 1)
    } catch (err) {
      setFormError(friendlyMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)

  return (
    <div className={styles.page}>
      <PageHead kicker="Admin" title="Users & Roles" lede="Operator and admin accounts. Customers live under Customers." />

      {formError && (
        <p className={styles.inlineError} role="alert">
          {formError}
        </p>
      )}

      {role === 'WAREHOUSE' && (
        <section className={ops.panel} aria-label="Create operator">
          <h2 className={ops.panelTitle}>Create operator</h2>
          <form onSubmit={(event) => void createOperator(event)}>
            <div className={ops.formGrid}>
              <label className={ops.field}>
                <span className={ops.label}>Email</span>
                <input
                  className={ops.input}
                  type="email"
                  value={opEmail}
                  onChange={(event) => setOpEmail(event.target.value)}
                  maxLength={200}
                />
              </label>
              <label className={ops.field}>
                <span className={ops.label}>Full name</span>
                <input
                  className={ops.input}
                  value={opName}
                  onChange={(event) => setOpName(event.target.value)}
                  maxLength={200}
                />
              </label>
              <label className={ops.field}>
                <span className={ops.label}>Password (min 8 chars)</span>
                <input
                  className={ops.input}
                  type="password"
                  autoComplete="new-password"
                  value={opPassword}
                  onChange={(event) => setOpPassword(event.target.value)}
                  maxLength={200}
                />
              </label>
              <label className={ops.field}>
                <span className={ops.label}>Warehouse</span>
                <select className={ops.select} value={opSite} onChange={(event) => setOpSite(event.target.value)}>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.code} · {site.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className={ops.btnRow}>
              <button type="submit" className={`${ops.btn} ${ops.btnPrimary}`} disabled={busy}>
                {busy ? 'Creating…' : 'Create operator'}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search size={15} aria-hidden="true" />
          <label className={styles.searchLabel} htmlFor="users-search">
            Search by email or name
          </label>
          <input
            id="users-search"
            className={styles.searchInput}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Email or name…"
            autoComplete="off"
          />
        </div>
        <label className={styles.filterWrap}>
          <span className={styles.filterLabel}>Role</span>
          <select
            className={styles.filterSelect}
            value={role}
            onChange={(event) => {
              setRole(event.target.value)
              setOffset(0)
            }}
            aria-label="Filter users by role"
          >
            <option value="WAREHOUSE">Warehouse</option>
            <option value="ADMIN">Admin</option>
            <option value="CUSTOMER">Customer</option>
          </select>
        </label>
      </div>

      {loading ? (
        <LoadingState label="Loading users…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
      ) : rows.length === 0 ? (
        <EmptyState title="No users" body="No accounts match this filter." />
      ) : (
        <>
          <div className={ops.tableWrap}>
            <table className={ops.table}>
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                  {role === 'WAREHOUSE' && <th scope="col">Toggle</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.full_name}
                      <div className={ops.muted}>{row.email}</div>
                    </td>
                    <td className={ops.mono}>{row.role.replaceAll('_', ' ')}</td>
                    <td>
                      <StatusBadge tone={row.active === 1 ? 'ok' : 'bad'}>
                        {row.active === 1 ? 'Active' : 'Disabled'}
                      </StatusBadge>
                    </td>
                    <td className={ops.mono}>{formatDate(row.created_at)}</td>
                    {role === 'WAREHOUSE' && (
                      <td>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          disabled={busy}
                          onClick={() => void toggleOperator(row)}
                        >
                          {row.active === 1 ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    )}
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
