import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ad } from '../../lib/admin'
import type { AdminNotification, AdminTemplate } from '../../lib/admin'
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

export default function Notifications() {
  const [rows, setRows] = useState<AdminNotification[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [templates, setTemplates] = useState<AdminTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [templateKey, setTemplateKey] = useState('')
  const [templateTitle, setTemplateTitle] = useState('')
  const [templateBody, setTemplateBody] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
        if (unreadOnly) params.set('unreadOnly', 'true')
        const [activity, tpl] = await Promise.all([
          ad<{ notifications: AdminNotification[]; total: number }>(`/notifications?${params.toString()}`),
          ad<{ templates: AdminTemplate[] }>('/notifications/templates'),
        ])
        if (!cancelled) {
          setRows(activity.notifications)
          setTotal(activity.total)
          setTemplates(tpl.templates)
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
  }, [unreadOnly, offset, attempt])

  async function saveTemplate(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setFormError(null)
    try {
      await ad(`/notifications/templates/${encodeURIComponent(templateKey.trim())}`, {
        method: 'PUT',
        body: { title: templateTitle, body: templateBody, active: true },
      })
      setTemplateKey('')
      setTemplateTitle('')
      setTemplateBody('')
      setAttempt((v) => v + 1)
    } catch (err) {
      setFormError(friendlyMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function toggleTemplate(template: AdminTemplate): Promise<void> {
    setBusy(true)
    setFormError(null)
    try {
      await ad(`/notifications/templates/${encodeURIComponent(template.key)}`, {
        method: 'PUT',
        body: { title: template.title, body: template.body, active: template.active !== 1 },
      })
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
      <PageHead kicker="Admin" title="Notifications" lede="Global notification activity plus message templates." />

      {formError && (
        <p className={styles.inlineError} role="alert">
          {formError}
        </p>
      )}

      <section className={ops.panel} aria-label="Activity">
        <h2 className={ops.panelTitle}>Activity ({total})</h2>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => {
              setUnreadOnly(event.target.checked)
              setOffset(0)
            }}
          />
          Unread only
        </label>
        {loading ? (
          <LoadingState label="Loading notifications…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
        ) : rows.length === 0 ? (
          <EmptyState title="No notifications" body="Nothing recorded." />
        ) : (
          <>
            <div className={ops.tableWrap}>
              <table className={ops.table}>
                <thead>
                  <tr>
                    <th scope="col">Recipient</th>
                    <th scope="col">Type</th>
                    <th scope="col">Title</th>
                    <th scope="col">Read</th>
                    <th scope="col">At</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className={ops.mono}>{row.user_email}</td>
                      <td className={ops.mono}>{row.type.replaceAll('_', ' ')}</td>
                      <td>{row.title}</td>
                      <td className={ops.mono}>{row.is_read === 1 ? 'yes' : 'no'}</td>
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
      </section>

      <section className={ops.panel} aria-label="Templates">
        <h2 className={ops.panelTitle}>Templates ({templates.length})</h2>
        <form onSubmit={(event) => void saveTemplate(event)}>
          <div className={ops.formGrid}>
            <label className={ops.field}>
              <span className={ops.label}>Key (A-Z, 0-9, _)</span>
              <input
                className={ops.input}
                value={templateKey}
                onChange={(event) => setTemplateKey(event.target.value.toUpperCase())}
                maxLength={60}
                placeholder="WELCOME_BACK"
              />
            </label>
            <label className={ops.field}>
              <span className={ops.label}>Title (supports {'{{variable}}'})</span>
              <input
                className={ops.input}
                value={templateTitle}
                onChange={(event) => setTemplateTitle(event.target.value)}
                maxLength={200}
              />
            </label>
            <label className={`${ops.field} ${ops.fieldFull}`}>
              <span className={ops.label}>Body</span>
              <textarea
                className={ops.textarea}
                value={templateBody}
                onChange={(event) => setTemplateBody(event.target.value)}
                rows={2}
                maxLength={2000}
              />
            </label>
          </div>
          <div className={ops.btnRow}>
            <button type="submit" className={`${ops.btn} ${ops.btnPrimary}`} disabled={busy}>
              {busy ? 'Saving…' : 'Save template'}
            </button>
          </div>
        </form>
        <div className={ops.tableWrap} style={{ marginTop: 'var(--sp-3)' }}>
          <table className={ops.table}>
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Title</th>
                <th scope="col">Status</th>
                <th scope="col">Toggle</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.key}>
                  <td className={ops.mono}>{template.key}</td>
                  <td>{template.title}</td>
                  <td className={ops.mono}>{template.active === 1 ? 'active' : 'disabled'}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      disabled={busy}
                      onClick={() => void toggleTemplate(template)}
                    >
                      {template.active === 1 ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
