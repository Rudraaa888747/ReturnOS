import { useEffect, useState } from 'react'
import { ad } from '../../lib/admin'
import type { AdminAuditEntry } from '../../lib/admin'
import { EmptyState, ErrorState, LoadingState, PageHead } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

const PAGE_SIZE = 25

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

export default function Audit() {
  const [action, setAction] = useState('')
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<AdminAuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
        if (action !== '') params.set('action', action)
        const data = await ad<{ entries: AdminAuditEntry[]; total: number }>(`/audit?${params.toString()}`)
        if (!cancelled) {
          setRows(data.entries)
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
  }, [action, offset, attempt])

  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)

  return (
    <div className={styles.page}>
      <PageHead kicker="Admin" title="Audit Logs" lede="Append-only trail of every admin action. No edit, no delete." />

      <div className={styles.toolbar}>
        <label className={styles.filterWrap}>
          <span className={styles.filterLabel}>Action (exact)</span>
          <input
            className={styles.inlineInput}
            value={action}
            onChange={(event) => {
              setAction(event.target.value)
              setOffset(0)
            }}
            placeholder="e.g. CREDIT_ADJUSTED"
            style={{ minWidth: 220 }}
          />
        </label>
      </div>

      {loading ? (
        <LoadingState label="Loading audit trail…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
      ) : rows.length === 0 ? (
        <EmptyState title="No audit entries" body="No admin actions match this filter." />
      ) : (
        <>
          <div className={ops.tableWrap}>
            <table className={ops.table}>
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Entity</th>
                  <th scope="col">Actor</th>
                  <th scope="col">At</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className={ops.mono}>{row.action.replaceAll('_', ' ')}</td>
                    <td className={ops.mono}>
                      {row.entity_type} · {row.entity_id.slice(0, 8)}…
                    </td>
                    <td className={ops.mono}>
                      {row.actor_role} · {(row.actor_id ?? '').slice(0, 8)}
                    </td>
                    <td className={ops.mono}>{formatDate(row.created_at)}</td>
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
