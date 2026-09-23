import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ad } from '../../lib/admin'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge, statusTone } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

function formatMoneyPaise(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '—'
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

interface Detail {
  ret: Record<string, string | null>;
  customer: { id: string; email: string; full_name: string };
  order: Record<string, string | number | null> | null;
  items: Array<Record<string, string | number | null>>;
  pickup: Record<string, string | null> | null;
  receiving: Record<string, string | number | null> | null;
  inspection: {
    inspection: Record<string, string | null>;
    findings: Array<Record<string, string | number | null>>;
  } | null;
  dispositions: Array<Record<string, string | number | null>>;
  refund: Record<string, string | number | null> | null;
  ledger: Array<Record<string, string | number | null>>;
  replacements: Array<{ id: string; order_number: string; kind: string | null; status: string }>;
  events: Array<{ id: string; status: string; description: string | null; created_at: string }>;
  documents: Array<{ id: string; kind: string; filename: string; created_at: string }>;
  audit: Array<{ id: string; actor_role: string; action: string; created_at: string }>;
}

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function Fact({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      <span className={mono ? ops.mono : styles.factValue}>{children}</span>
    </div>
  )
}

export default function ReturnDetail() {
  const { id } = useParams()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      if (!id) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const data = await ad<Detail>(`/returns/${id}`)
        if (!cancelled) setDetail(data)
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 404) {
            setNotFound(true)
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
  }, [id, attempt])

  if (loading) {
    return (
      <div>
        <PageHead kicker="Admin" title="Return" lede="Loading the lifecycle file." />
        <LoadingState label="Loading return…" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div>
        <PageHead kicker="Admin" title="Return" lede="Check the link and try again." />
        <ErrorState message="Return not found." />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div>
        <PageHead kicker="Admin" title="Return" lede="Check the link and try again." />
        <ErrorState message={error ?? 'Return could not be loaded.'} onRetry={() => setAttempt((v) => v + 1)} />
      </div>
    )
  }

  const { ret } = detail

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Admin"
        title={text(ret.return_number)}
        lede={`Requested ${formatDate(typeof ret.created_at === 'string' ? ret.created_at : null)}`}
        actions={<Link to="/admin/returns">Back to returns</Link>}
      />

      <section className={ops.panel} aria-label="Lifecycle overview">
        <div className={styles.factGrid}>
          <Fact label="Status">
            <StatusBadge tone={statusTone(String(ret.status))}>{String(ret.status).replaceAll('_', ' ')}</StatusBadge>
          </Fact>
          <Fact label="Customer">
            <Link to={`/admin/customers/${ret.customer_id}`}>{detail.customer.full_name}</Link>
          </Fact>
          <Fact label="Order">
            {detail.order ? (
              <Link className={ops.mono} to={`/admin/orders/${ret.order_id}`}>
                {text(detail.order.order_number)}
              </Link>
            ) : (
              '—'
            )}
          </Fact>
          <Fact label="Resolution" mono>
            {text(ret.resolution_type).replaceAll('_', ' ')}
          </Fact>
          <Fact label="Approved" mono>
            {typeof ret.approved_at === 'string' && ret.approved_at !== '' ? formatDate(ret.approved_at) : 'Not approved'}
          </Fact>
        </div>
      </section>

      <div className={styles.twoCol}>
        <section className={ops.panel} aria-label="Items and pickup">
          <h2 className={ops.panelTitle}>Items ({detail.items.length})</h2>
          <ul className={styles.plainList}>
            {detail.items.map((item) => (
              <li key={String(item.id)}>
                {String(item.product_name)} × {String(item.quantity)}{' '}
                <span className={ops.muted}>
                  {String(item.reason_code)} · {String(item.sku)}
                </span>
              </li>
            ))}
          </ul>
          <h3 className={styles.subTitle}>Pickup</h3>
          {detail.pickup ? (
            <p className={ops.muted}>
              {text(detail.pickup.kind).replaceAll('_', ' ')} · {text(detail.pickup.status).replaceAll('_', ' ')}
              {typeof detail.pickup.tracking_number === 'string' && detail.pickup.tracking_number !== ''
                ? ` · ${detail.pickup.tracking_number}`
                : ''}
            </p>
          ) : (
            <p className={ops.muted}>No pickup scheduled.</p>
          )}
          <h3 className={styles.subTitle}>Receiving</h3>
          {detail.receiving ? (
            <p className={ops.muted}>
              {text(detail.receiving.warehouse_code)} · {text(detail.receiving.package_condition).replaceAll('_', ' ')} ·{' '}
              {text(detail.receiving.discrepancy).replaceAll('_', ' ')}
            </p>
          ) : (
            <p className={ops.muted}>Not received yet.</p>
          )}
          <h3 className={styles.subTitle}>Inspection</h3>
          {!detail.inspection ? (
            <p className={ops.muted}>Not inspected yet.</p>
          ) : (
            <ul className={styles.plainList}>
              {detail.inspection.findings.map((finding) => (
                <li key={String(finding.id)}>
                  <span className={ops.mono}>{String(finding.result).replaceAll('_', ' ')}</span>{' '}
                  <span className={ops.muted}>× {String(finding.quantity)}</span>
                </li>
              ))}
            </ul>
          )}
          <h3 className={styles.subTitle}>Dispositions ({detail.dispositions.length})</h3>
          {detail.dispositions.length === 0 ? (
            <p className={ops.muted}>None recorded.</p>
          ) : (
            <ul className={styles.plainList}>
              {detail.dispositions.map((row) => (
                <li key={String(row.id)}>
                  <span className={ops.mono}>
                    {String(row.action).replaceAll('_', ' ')} × {String(row.quantity)}
                  </span>{' '}
                  <span className={ops.muted}>{formatMoneyPaise(typeof row.recovery_value_paise === 'number' ? row.recovery_value_paise : null)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={ops.panel} aria-label="Resolution and money">
          <h2 className={ops.panelTitle}>Resolution</h2>
          {detail.refund ? (
            <div className={styles.factGrid}>
              <Fact label="Kind" mono>
                {text(detail.refund.kind).replaceAll('_', ' ')}
              </Fact>
              <Fact label="Amount" mono>
                {formatMoneyPaise(typeof detail.refund.amount_paise === 'number' ? detail.refund.amount_paise : null)}
              </Fact>
              <Fact label="Status" mono>
                {text(detail.refund.status).replaceAll('_', ' ')}
              </Fact>
            </div>
          ) : (
            <p className={ops.muted}>No refund row.</p>
          )}
          <h3 className={styles.subTitle}>Store credit entries ({detail.ledger.length})</h3>
          {detail.ledger.length === 0 ? (
            <p className={ops.muted}>None.</p>
          ) : (
            <ul className={styles.plainList}>
              {detail.ledger.map((entry) => (
                <li key={String(entry.id)}>
                  <span className={ops.mono}>
                    {String(entry.type)} {formatMoneyPaise(typeof entry.amount_paise === 'number' ? entry.amount_paise : null)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h3 className={styles.subTitle}>Replacements ({detail.replacements.length})</h3>
          {detail.replacements.length === 0 ? (
            <p className={ops.muted}>None.</p>
          ) : (
            <ul className={styles.plainList}>
              {detail.replacements.map((rep) => (
                <li key={rep.id}>
                  <Link className={ops.mono} to={`/admin/orders/${rep.id}`}>
                    {rep.order_number}
                  </Link>{' '}
                  <StatusBadge tone={statusTone(rep.status)}>{rep.status.replaceAll('_', ' ')}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
          <h3 className={styles.subTitle}>Evidence ({detail.documents.length})</h3>
          {detail.documents.length === 0 ? (
            <p className={ops.muted}>No documents.</p>
          ) : (
            <ul className={styles.plainList}>
              {detail.documents.map((doc) => (
                <li key={doc.id}>
                  {doc.filename} <span className={ops.muted}>· {doc.kind}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className={ops.panel} aria-label="Timeline and audit">
        <h2 className={ops.panelTitle}>Timeline ({detail.events.length})</h2>
        {detail.events.length === 0 ? (
          <EmptyState title="No events" body="Nothing recorded for this return yet." />
        ) : (
          <ol className={styles.timeline}>
            {detail.events.map((event) => (
              <li key={event.id} className={styles.timelineItem}>
                <span className={styles.timelineStatus}>{event.status.replaceAll('_', ' ')}</span>
                <span className={styles.timelineDate}>{formatDate(event.created_at)}</span>
                {event.description && <span className={styles.timelineDesc}>{event.description}</span>}
              </li>
            ))}
          </ol>
        )}
        <h3 className={styles.subTitle}>Warehouse audit ({detail.audit.length})</h3>
        {detail.audit.length === 0 ? (
          <p className={ops.muted}>No floor actions recorded.</p>
        ) : (
          <ul className={styles.plainList}>
            {detail.audit.map((entry) => (
              <li key={entry.id}>
                <span className={ops.mono}>{entry.action.replaceAll('_', ' ')}</span>{' '}
                <span className={ops.muted}>
                  {entry.actor_role} · {formatDate(entry.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
