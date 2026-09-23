import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Send } from 'lucide-react';
import { api, friendlyMessage } from '../../lib/api';
import type { ReturnRow, TicketMessageRow, TicketRow } from '../../lib/api';
import { EmptyState, ErrorState, FieldError, LoadingState, PageHead, StatusBadge, statusTone } from '../../components/ui';
import styles from './support.module.css';

interface CreateTicketResponse {
  ticket: TicketRow;
  messages?: TicketMessageRow[];
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export default function Support() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectReturnId = searchParams.get('returnId') ?? '';

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [returnId, setReturnId] = useState(preselectReturnId);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [ticketData, returnData] = await Promise.all([
        api<{ tickets: TicketRow[] }>('/support/tickets'),
        api<{ returns: ReturnRow[] }>('/returns').catch(() => ({ returns: [] as ReturnRow[] })),
      ]);
      setTickets(ticketData.tickets);
      setReturns(returnData.returns);
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (preselectReturnId) setReturnId(preselectReturnId);
  }, [preselectReturnId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const problems: Record<string, string> = {};
    if (subject.trim() === '') problems.subject = 'Enter a subject so support can triage your request.';
    if (body.trim() === '') problems.body = 'Describe your issue in a few sentences.';
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setCreating(true);
    setCreateError(null);
    try {
      const data = await api<CreateTicketResponse>('/support/tickets', {
        method: 'POST',
        body: {
          subject: subject.trim(),
          body: body.trim(),
          returnId: returnId === '' ? undefined : returnId,
        },
      });
      navigate(`/customer/support/${data.ticket.id}`, { state: { created: true } });
    } catch (err) {
      setCreateError(friendlyMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Support"
        title="Help and support"
        lede="Raise a ticket and our team will get back to you. Link a return so we can help faster."
      />

      {loading ? (
        <LoadingState label="Loading tickets…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        <>
          {tickets.length === 0 ? (
            <EmptyState title="No tickets yet" body="Support conversations you start will appear here with their current status." />
          ) : (
            <ul className={styles.list}>
              {tickets.map((ticket) => (
                <li key={ticket.id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <span className={styles.ticketNumber}>{ticket.ticket_number}</span>
                    <StatusBadge tone={statusTone(ticket.status)}>{ticket.status.replaceAll('_', ' ')}</StatusBadge>
                  </div>
                  <p className={styles.ticketSubject}>{ticket.subject}</p>
                  <p className={styles.cardMeta}>
                    Updated {formatDate(ticket.updated_at)}
                    {ticket.return_id ? ` · linked return ${ticket.return_id}` : ''}
                  </p>
                  <div className={styles.cardFoot}>
                    <Link className={styles.link} to={`/customer/support/${ticket.id}`}>
                      Open conversation
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <section className={styles.panel} aria-labelledby="new-ticket-h">
            <h2 id="new-ticket-h">
              <Plus size={17} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />
              New ticket
            </h2>
            <p className={styles.panelLede}>We usually reply within one business day.</p>
            <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="ticket-subject">
                  Subject
                </label>
                <input
                  id="ticket-subject"
                  className={styles.input}
                  type="text"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  aria-describedby="ticket-subject-error"
                  maxLength={200}
                  placeholder="Example: Pickup missed for my return"
                />
                <FieldError id="ticket-subject-error" message={fieldErrors.subject ?? null} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="ticket-return">
                  Related return (optional)
                </label>
                <select
                  id="ticket-return"
                  className={styles.select}
                  value={returnId}
                  onChange={(event) => setReturnId(event.target.value)}
                >
                  <option value="">No linked return</option>
                  {returns.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.return_number} · {row.status.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="ticket-body">
                  What do you need help with?
                </label>
                <textarea
                  id="ticket-body"
                  className={styles.textarea}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  aria-describedby="ticket-body-error"
                  rows={5}
                  maxLength={5000}
                />
                <FieldError id="ticket-body-error" message={fieldErrors.body ?? null} />
              </div>
              {createError && (
                <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
                  {createError}
                </p>
              )}
              <div className={styles.actions}>
                <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={creating}>
                  <Send size={16} aria-hidden="true" />
                  {creating ? 'Creating…' : 'Create ticket'}
                </button>
              </div>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
