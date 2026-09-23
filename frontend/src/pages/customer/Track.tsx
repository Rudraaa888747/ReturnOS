import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PackageSearch } from 'lucide-react'
import { ApiError, api, friendlyMessage } from '../../lib/api'
import type { TrackingResult } from '../../lib/api'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge, statusTone } from '../../components/ui'
import styles from './track.module.css'

const RETURN_PATTERN = /^RET-\d{4}-\d{4}$/i

function nextStepHint(status: string): string {
  const normalized = status.toUpperCase()
  switch (normalized) {
    case 'REQUESTED':
      return 'Your request was received and is waiting for approval. You will be notified once it is reviewed.'
    case 'APPROVED':
      return 'Your return was approved. Pack the item and hand it over for pickup or shipment.'
    case 'IN_TRANSIT':
      return 'Your item is on its way back. Keep the packaging intact until it reaches the warehouse.'
    case 'RECEIVED':
      return 'Your item arrived at the warehouse and is queued for inspection.'
    case 'INSPECTION_PENDING':
    case 'INSPECTION_IN_PROGRESS':
      return 'Your item is being inspected. The outcome will decide the final resolution.'
    case 'INSPECTION_COMPLETED':
      return 'Inspection is complete. Your refund or replacement is being prepared.'
    case 'COMPLETED':
      return 'This return is complete. Check the resolution panel below for refund details.'
    case 'REJECTED':
      return 'This return was rejected. Contact support if you need to appeal the decision.'
    case 'CANCELLED':
      return 'This return was cancelled. Start a new request if you still need to return the item.'
    default:
      return 'Watch this page for status changes. You will be notified of every important update.'
  }
}

function formatMoney(value: number | null): string {
  if (value === null) return '—'
  return `₹${value.toLocaleString('en-IN')}`
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

function humanize(value: string | null | undefined): string {
  if (!value) return '—'
  return value
    .toLowerCase()
    .split('_')
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ')
}

export default function Track() {
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinked = (searchParams.get('number') ?? '').trim().toUpperCase()

  const [input, setInput] = useState(deepLinked)
  const [query, setQuery] = useState(deepLinked)
  const [result, setResult] = useState<TrackingResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<'not-found' | 'unauthorized' | 'server' | 'other' | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)

  // Keep the input in sync when a ?number= link is opened.
  useEffect(() => {
    setInput(deepLinked)
    setQuery(deepLinked)
  }, [deepLinked])

  const fetchTracking = useCallback(async (returnNumber: string) => {
    setLoading(true)
    setError(null)
    setErrorKind(null)
    setResult(null)
    try {
      const data = await api<TrackingResult>(`/tracking/${encodeURIComponent(returnNumber)}`)
      setResult(data)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          setErrorKind('not-found')
          setError('Return not found. Check the return number, or make sure you are tracking a return from your own account.')
        } else if (err.status === 401) {
          setErrorKind('unauthorized')
          setError('Your session has expired. Please log in again to track your return.')
        } else if (err.status >= 500) {
          setErrorKind('server')
          setError(friendlyMessage(err))
        } else {
          setErrorKind('other')
          setError(friendlyMessage(err))
        }
      } else {
        setErrorKind('other')
        setError(friendlyMessage(err))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (query) {
      void fetchTracking(query)
    }
  }, [query, fetchTracking])

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const normalized = input.trim().toUpperCase()
    if (!RETURN_PATTERN.test(normalized)) {
      setFieldError('Enter a return number in the format RET-YYYY-NNNN, for example RET-2026-0001.')
      return
    }
    setFieldError(null)
    setSearchParams({ number: normalized })
    setQuery(normalized)
  }

  function handleRetry(): void {
    if (query) {
      void fetchTracking(query)
    }
  }

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Customer"
        title="Track a Return"
        lede="Enter your return number to see live status, pickup details, and resolution progress."
      />

      <section className={styles.panel} aria-label="Track a return">
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="return-number">
              Return number
            </label>
            <input
              id="return-number"
              className={styles.input}
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value.toUpperCase())}
              placeholder="RET-YYYY-NNNN"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={fieldError ? 'return-number-error' : 'return-number-hint'}
              aria-invalid={fieldError !== null}
            />
            {fieldError ? (
              <p className={styles.fieldError} id="return-number-error" role="alert">
                {fieldError}
              </p>
            ) : (
              <p className={styles.hint} id="return-number-hint">
                Example: RET-2026-0001. You can also open this page with ?number=RET-2026-0001.
              </p>
            )}
          </div>
          <button type="submit" className={styles.submit} disabled={loading}>
            <PackageSearch size={16} aria-hidden="true" />
            {loading ? 'Tracking…' : 'Track'}
          </button>
        </form>
      </section>

      {loading && <LoadingState label="Looking up return status" />}

      {!loading && !query && !result && !error && (
        <EmptyState
          title="No return selected"
          body="Enter a return number above to see its current status, timeline, and pickup information."
        />
      )}

      {!loading && error && errorKind === 'unauthorized' && (
        <section className={styles.panel} aria-label="Session expired">
          <ErrorState message={error} />
          <p className={styles.hint} style={{ marginTop: 'var(--sp-3)' }}>
            <Link to="/login">Go to login</Link> to continue tracking your returns.
          </p>
        </section>
      )}

      {!loading && error && errorKind !== 'unauthorized' && (
        <div>
          <ErrorState
            message={error}
            onRetry={errorKind === 'server' || errorKind === 'other' ? handleRetry : undefined}
          />
          {errorKind === 'server' && (
            <div className={styles.retryRow}>
              <button type="button" className={styles.submit} onClick={handleRetry}>
                Retry
              </button>
            </div>
          )}
        </div>
      )}

      {!loading && result && (
        <div className={styles.columns}>
          <section className={styles.panel} aria-label="Return status">
            <div className={styles.statusRow}>
              <span className={styles.returnNumber}>{result.returnNumber}</span>
              <StatusBadge tone={statusTone(result.status)}>{result.status}</StatusBadge>
            </div>
            <p className={styles.updated}>Last update: {new Date(result.updatedAt).toLocaleString()}</p>
            {result.resolutionType && <p className={styles.updated}>Resolution: {result.resolutionType}</p>}
            <div className={styles.nextStep} role="status">
              <strong>Next step</strong>
              {nextStepHint(result.status)}
            </div>

            <h2 className={`${styles.panelTitle} ${styles.subHead}`}>Timeline</h2>
            {result.events.length === 0 ? (
              <p className={styles.hint}>No tracking events yet. Check back soon.</p>
            ) : (
              <ol className={styles.timeline}>
                {result.events.map((event, index) => (
                  <li key={event.id} className={`${styles.event} ${index === 0 ? styles.eventFirst : ''}`}>
                    <span className={styles.eventDot} aria-hidden="true" />
                    <div className={styles.eventStatus}>{event.status}</div>
                    {event.description && <div className={styles.eventDesc}>{event.description}</div>}
                    <div className={styles.eventTime}>{new Date(event.created_at).toLocaleString()}</div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div>
            <section className={styles.panel} aria-label="Pickup and logistics" style={{ marginBottom: 'var(--sp-4)' }}>
              <h2 className={styles.panelTitle}>Pickup and logistics</h2>
              {!result.pickup ? (
                <p className={styles.hint}>No pickup has been scheduled for this return yet.</p>
              ) : (
                <dl className={styles.kv}>
                  <dt>Method</dt>
                  <dd>{humanize(result.pickup.kind)}</dd>
                  <dt>Status</dt>
                  <dd>{humanize(result.pickup.status)}</dd>
                  {result.pickup.carrier && (
                    <>
                      <dt>Carrier</dt>
                      <dd>{result.pickup.carrier}</dd>
                    </>
                  )}
                  {result.pickup.tracking_number && (
                    <>
                      <dt>Tracking no.</dt>
                      <dd>{result.pickup.tracking_number}</dd>
                    </>
                  )}
                  {result.pickup.address && (
                    <>
                      <dt>Address</dt>
                      <dd>{result.pickup.address}</dd>
                    </>
                  )}
                  {result.pickup.date && (
                    <>
                      <dt>Date</dt>
                      <dd>{formatDate(result.pickup.date)}</dd>
                    </>
                  )}
                  {result.pickup.time_window && (
                    <>
                      <dt>Time window</dt>
                      <dd>{result.pickup.time_window}</dd>
                    </>
                  )}
                </dl>
              )}
            </section>

            <section className={styles.panel} aria-label="Resolution">
              <h2 className={styles.panelTitle}>Resolution</h2>
              {!result.refund ? (
                <p className={styles.hint}>No refund or resolution has been issued yet.</p>
              ) : (
                <dl className={styles.kv}>
                  <dt>Type</dt>
                  <dd>{humanize(result.refund.kind)}</dd>
                  <dt>Status</dt>
                  <dd>{humanize(result.refund.status)}</dd>
                  <dt>Amount</dt>
                  <dd>{formatMoney(result.refund.amount)}</dd>
                  {result.refund.method && (
                    <>
                      <dt>Method</dt>
                      <dd>{humanize(result.refund.method)}</dd>
                    </>
                  )}
                  {result.refund.initiated_at && (
                    <>
                      <dt>Initiated</dt>
                      <dd>{new Date(result.refund.initiated_at).toLocaleString()}</dd>
                    </>
                  )}
                  {result.refund.completed_at && (
                    <>
                      <dt>Completed</dt>
                      <dd>{new Date(result.refund.completed_at).toLocaleString()}</dd>
                    </>
                  )}
                </dl>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
