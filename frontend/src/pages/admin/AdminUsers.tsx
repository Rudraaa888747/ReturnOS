import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
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

export default function AdminUsers() {
  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')

  async function load(signal?: AbortSignal): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ role: 'ADMIN', limit: String(PAGE_SIZE), offset: String(offset) })
      const data = await ad<{ users: AdminUserRow[]; total: number }>(`/users?${params.toString()}`, { signal })
      setRows(data.users)
      setTotal(data.total)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
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
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, attempt])

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setFormError(null)
    try {
      await ad('/users', { method: 'POST', body: { email: email.trim(), password, fullName: fullName.trim() } })
      setEmail('')
      setPassword('')
      setFullName('')
      await load()
    } catch (err) {
      setFormError(friendlyMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(user: AdminUserRow): Promise<void> {
    if (!window.confirm(`${user.active === 1 ? 'Disable' : 'Enable'} admin ${user.email}? ${user.active === 1 ? 'Self-lockout and last-admin rules apply.' : ''}`)) {
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      await ad(`/users/${user.id}`, { method: 'PATCH', body: { active: user.active !== 1 } })
      await load()
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
      <PageHead
        kicker="Admin"
        title="Admin Users"
        lede="Accounts with full console access. Self-lockout and last-admin rules are enforced."
      />

      {formError && (
        <p className={styles.inlineError} role="alert">
          {formError}
        </p>
      )}

      <section className={ops.panel} aria-label="Create admin">
        <h2 className={ops.panelTitle}>Create admin</h2>
        <form onSubmit={(event) => void create(event)}>
          <div className={ops.formGrid}>
            <label className={ops.field}>
              <span className={ops.label}>Email</span>
              <input
                className={ops.input}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={200}
              />
            </label>
            <label className={ops.field}>
              <span className={ops.label}>Full name</span>
              <input
                className={ops.input}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                maxLength={200}
              />
            </label>
            <label className={ops.field}>
              <span className={ops.label}>Password (min 8 chars)</span>
              <input
                className={ops.input}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                maxLength={200}
              />
            </label>
          </div>
          <div className={ops.btnRow}>
            <button type="submit" className={`${ops.btn} ${ops.btnPrimary}`} disabled={busy}>
              {busy ? 'Creating…' : 'Create admin'}
            </button>
          </div>
        </form>
      </section>

      <section className={ops.panel} aria-label="Admin list">
        <h2 className={ops.panelTitle}>Admins ({total})</h2>
        {loading ? (
          <LoadingState label="Loading admins…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
        ) : rows.length === 0 ? (
          <EmptyState title="No admins" body="No admin accounts found." />
        ) : (
          <>
            <div className={ops.tableWrap}>
              <table className={ops.table}>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Status</th>
                    <th scope="col">Created</th>
                    <th scope="col">Toggle</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.full_name}
                        <div className={ops.muted}>{row.email}</div>
                      </td>
                      <td>
                        <StatusBadge tone={row.active === 1 ? 'ok' : 'bad'}>
                          {row.active === 1 ? 'Active' : 'Disabled'}
                        </StatusBadge>
                      </td>
                      <td className={ops.mono}>{formatDate(row.created_at)}</td>
                      <td>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          disabled={busy}
                          onClick={() => void toggle(row)}
                        >
                          {row.active === 1 ? 'Disable' : 'Enable'}
                        </button>
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
      </section>
    </div>
  )
}
