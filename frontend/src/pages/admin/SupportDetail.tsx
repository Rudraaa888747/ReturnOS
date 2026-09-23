import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ad } from '../../lib/admin'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge, statusTone } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

interface Detail {
  ticket: {
    id: string;
    ticket_number: string;
    user_id: string;
    customer_email: string;
    customer_name: string;
    return_id: string | null;
    return_number: string | null;
    subject: string;
    status: string;
    priority: string;
    assigned_to: string | null;
    assignee_email: string | null;
    created_at: string;
    updated_at: string;
  };
  messages: Array<{ id: string; author_role: string; body: string; created_at: string }>;
}

export default function SupportDetail() {
  const { id } = useParams()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [assignee, setAssignee] = useState('')
  const [priority, setPriority] = useState('')

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
      const data = await ad<Detail>(`/support/tickets/${id}`, { signal })
      setDetail(data)
      setAssignee(data.ticket.assigned_to ?? '')
      setPriority(data.ticket.priority)
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

  async function mutate(path: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true)
    setFormError(null)
    try {
      await ad(path, { method, body })
      await load()
      return true
    } catch (err) {
      setFormError(friendlyMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  function sendReply(event: FormEvent): void {
    event.preventDefault()
    if (!id || reply.trim() === '') {
      setFormError('Reply body is required.')
      return
    }
    void mutate(`/support/tickets/${id}/messages`, 'POST', { body: reply.trim() }).then((ok) => {
      if (ok) setReply('')
    })
  }

  if (loading) {
    return (
      <div>
        <PageHead kicker="Admin" title="Ticket" lede="Loading the conversation." />
        <LoadingState label="Loading ticket…" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div>
        <PageHead kicker="Admin" title="Ticket" lede="Check the link and try again." />
        <ErrorState message="Ticket not found." />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div>
        <PageHead kicker="Admin" title="Ticket" lede="Check the link and try again." />
        <ErrorState message={error ?? 'Ticket could not be loaded.'} onRetry={() => setAttempt((v) => v + 1)} />
      </div>
    )
  }

  const { ticket } = detail
  const closed = ticket.status === 'CLOSED'

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Admin"
        title={ticket.ticket_number}
        lede={ticket.subject}
        actions={<Link to="/admin/support">Back to tickets</Link>}
      />

      <section className={ops.panel} aria-label="Ticket facts">
        <div className={styles.factGrid}>
          <Fact label="Status">
            <StatusBadge tone={statusTone(ticket.status)}>{ticket.status.replaceAll('_', ' ')}</StatusBadge>
          </Fact>
          <Fact label="Priority" mono>
            {ticket.priority.replaceAll('_', ' ')}
          </Fact>
          <Fact label="Customer">
            <Link to={`/admin/customers/${ticket.user_id}`}>{ticket.customer_name}</Link>
          </Fact>
          <Fact label="Assignee" mono>
            {ticket.assignee_email ?? 'Unassigned'}
          </Fact>
          {ticket.return_id && (
            <Fact label="Return">
              <Link className={ops.mono} to={`/admin/returns/${ticket.return_id}`}>
                {ticket.return_number ?? ticket.return_id}
              </Link>
            </Fact>
          )}
        </div>
        {formError && (
          <p className={styles.inlineError} role="alert">
            {formError}
          </p>
        )}
        <div className={styles.toolbar}>
          <label className={styles.filterWrap}>
            <span className={styles.filterLabel}>Assign (admin/warehouse id)</span>
            <input
              className={styles.inlineInput}
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              placeholder="user id or empty to unassign"
            />
          </label>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={busy}
            onClick={() => id && void mutate(`/support/tickets/${id}`, 'PATCH', { assignedTo: assignee === '' ? null : assignee })}
          >
            Assign
          </button>
          <label className={styles.filterWrap}>
            <span className={styles.filterLabel}>Priority</span>
            <select
              className={styles.filterSelect}
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              aria-label="Ticket priority"
            >
              {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={busy}
            onClick={() => id && void mutate(`/support/tickets/${id}`, 'PATCH', { priority })}
          >
            Set priority
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={busy}
            onClick={() => id && void mutate(`/support/tickets/${id}`, 'PATCH', { status: closed ? 'OPEN' : 'CLOSED' })}
          >
            {closed ? 'Reopen' : 'Close'}
          </button>
        </div>
      </section>

      <section className={ops.panel} aria-label="Conversation">
        <h2 className={ops.panelTitle}>Conversation ({detail.messages.length})</h2>
        {detail.messages.length === 0 ? (
          <EmptyState title="No messages" body="Nothing written on this ticket yet." />
        ) : (
          <ol className={styles.timeline}>
            {detail.messages.map((message) => (
              <li key={message.id} className={styles.timelineItem}>
                <span className={styles.timelineStatus}>{message.author_role.replaceAll('_', ' ')}</span>
                <span className={styles.timelineDate}>{formatDate(message.created_at)}</span>
                <span className={styles.timelineDesc}>{message.body}</span>
              </li>
            ))}
          </ol>
        )}
        {!closed && (
          <form onSubmit={sendReply}>
            <label className={ops.field} style={{ marginTop: 'var(--sp-3)' }}>
              <span className={ops.label}>Reply as support</span>
              <textarea
                className={ops.textarea}
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                rows={3}
                maxLength={5000}
              />
            </label>
            <div className={ops.btnRow}>
              <button type="submit" className={`${ops.btn} ${ops.btnPrimary}`} disabled={busy}>
                {busy ? 'Sending…' : 'Send reply'}
              </button>
            </div>
          </form>
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
