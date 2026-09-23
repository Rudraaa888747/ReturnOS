import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import { api, friendlyMessage } from '../../lib/api';
import type { TicketDetail, TicketMessageRow, TicketRow } from '../../lib/api';
import { ErrorState, FieldError, LoadingState, PageHead, StatusBadge, statusTone } from '../../components/ui';
import styles from './support.module.css';

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function isClosed(status: string): boolean {
  return status.toUpperCase() === 'CLOSED' || status.toUpperCase() === 'RESOLVED';
}

export default function SupportDetail() {
  const { id } = useParams();
  const location = useLocation();
  const created = ((location.state as { created?: boolean } | null) ?? {}).created === true;

  const [ticket, setTicket] = useState<TicketRow | null>(null);
  const [messages, setMessages] = useState<TicketMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reply, setReply] = useState('');
  const [replyPending, setReplyPending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeNotice, setCloseNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api<TicketDetail>(`/support/tickets/${id}`);
      setTicket(data.ticket);
      setMessages(data.messages);
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleReply(event: FormEvent) {
    event.preventDefault();
    if (!id || reply.trim() === '') {
      setReplyError('Write a message before sending.');
      return;
    }
    setReplyPending(true);
    setReplyError(null);
    try {
      const data = await api<{ message: TicketMessageRow }>(`/support/tickets/${id}/messages`, {
        method: 'POST',
        body: { body: reply.trim() },
      });
      setMessages((prev) => [...prev, data.message]);
      setReply('');
    } catch (err) {
      setReplyError(friendlyMessage(err));
    } finally {
      setReplyPending(false);
    }
  }

  async function handleClose() {
    if (!id || !ticket) return;
    const confirmed = window.confirm(`Close ticket ${ticket.ticket_number}? You can still read it afterwards.`);
    if (!confirmed) return;
    setClosing(true);
    setCloseError(null);
    setCloseNotice(null);
    try {
      const data = await api<{ ticket: TicketRow }>(`/support/tickets/${id}/close`, { method: 'POST' });
      setTicket(data.ticket);
      setCloseNotice('Ticket closed. Thank you for letting us help.');
    } catch (err) {
      setCloseError(friendlyMessage(err));
    } finally {
      setClosing(false);
    }
  }

  if (loading) return <LoadingState label="Loading conversation…" />;
  if (error || !ticket) {
    return (
      <div className={styles.page}>
        <Link className={styles.backLink} to="/customer/support">
          <ArrowLeft size={16} aria-hidden="true" /> Back to support
        </Link>
        <ErrorState message={error ?? 'Ticket not found.'} onRetry={() => void load()} />
      </div>
    );
  }

  const closed = isClosed(ticket.status);

  return (
    <div className={styles.page}>
      <Link className={styles.backLink} to="/customer/support">
        <ArrowLeft size={16} aria-hidden="true" /> Back to support
      </Link>
      <PageHead
        kicker="Support ticket"
        title={ticket.ticket_number}
        lede={ticket.subject}
        actions={<StatusBadge tone={statusTone(ticket.status)}>{ticket.status.replaceAll('_', ' ')}</StatusBadge>}
      />

      {created && (
        <p className={`${styles.notice} ${styles.noticeOk}`} role="status">
          Your ticket was created. Describe anything else below and we will pick it up from here.
        </p>
      )}

      <section className={styles.meta} aria-label="Ticket details">
        <dl className={styles.kv}>
          <div>
            <dt>Subject</dt>
            <dd>{ticket.subject}</dd>
          </div>
          <div>
            <dt>Linked return</dt>
            <dd className={styles.mono}>{ticket.return_id ?? 'None'}</dd>
          </div>
          <div>
            <dt>Opened</dt>
            <dd>{formatDate(ticket.created_at)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatDate(ticket.updated_at)}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.panel} aria-labelledby="thread-h">
        <h2 id="thread-h">Conversation</h2>
        {messages.length === 0 ? (
          <p className={styles.panelLede}>No messages yet. Start the conversation below.</p>
        ) : (
          <ul className={styles.thread}>
            {messages.map((message) => {
              const staff = message.author_role.toUpperCase() !== 'CUSTOMER';
              return (
                <li key={message.id} className={`${styles.message} ${staff ? styles.messageStaff : ''}`}>
                  <div className={styles.messageHead}>
                    <span className={styles.messageAuthor}>{staff ? 'Support team' : 'You'}</span>
                    <span>{formatDate(message.created_at)}</span>
                  </div>
                  <p className={styles.messageBody}>{message.body}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!closed ? (
        <section className={styles.panel} aria-labelledby="reply-h">
          <h2 id="reply-h">Reply</h2>
          <form className={styles.form} onSubmit={(event) => void handleReply(event)} noValidate>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="reply-body">
                Your message
              </label>
              <textarea
                id="reply-body"
                className={styles.textarea}
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                aria-describedby="reply-body-error"
                rows={4}
                maxLength={5000}
              />
              <FieldError id="reply-body-error" message={replyError} />
            </div>
            <div className={styles.actions}>
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={replyPending}>
                <Send size={16} aria-hidden="true" />
                {replyPending ? 'Sending…' : 'Send reply'}
              </button>
              <button type="button" className={styles.btn} disabled={closing} onClick={() => void handleClose()}>
                {closing ? 'Closing…' : 'Close ticket'}
              </button>
            </div>
            {closeError && (
              <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
                {closeError}
              </p>
            )}
            {closeNotice && (
              <p className={`${styles.notice} ${styles.noticeOk}`} role="status">
                {closeNotice}
              </p>
            )}
          </form>
        </section>
      ) : (
        <p className={styles.notice} role="status">
          This ticket is closed. Start a new ticket from the support page if you need further help.
        </p>
      )}
    </div>
  );
}
