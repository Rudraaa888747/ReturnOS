import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { wh } from '../../lib/warehouse'
import type {
  DispositionRow,
  WarehouseContext,
  WarehouseReturnDetail,
  WarehouseReturnLine,
} from '../../lib/warehouse'
import { ErrorState, LoadingState, PageHead, StatusBadge, statusTone } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from './ops.module.css'
import styles from './detail.module.css'

/* Controlled vocabularies mirror the backend CHECK constraints. They only
 * populate dropdowns — every value is re-validated server-side. */
const PACKAGE_CONDITIONS = ['SEALED', 'OPENED', 'DAMAGED'] as const
const RECEIVING_DISCREPANCIES = ['NONE', 'WRONG_ITEM', 'QUANTITY_MISMATCH', 'DAMAGED_PACKAGE', 'MISSING_ITEM'] as const
const INSPECTION_RESULTS = ['PASS', 'DAMAGED', 'DEFECTIVE', 'INCOMPLETE', 'WRONG_ITEM', 'UNSELLABLE'] as const
const CONDITION_GRADES = ['NEW', 'LIKE_NEW', 'USED', 'DAMAGED', 'UNUSABLE'] as const
const ALL_DISPOSITIONS = ['RESTOCK', 'RESELL', 'REPAIR', 'RETURN_TO_VENDOR', 'RECYCLE', 'DISPOSE'] as const

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function formatMoneyPaise(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '—'
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

function nullIfEmpty(value: string): string | null {
  return value.trim() === '' ? null : value.trim()
}

function priorityClass(priority: string): string {
  if (priority === 'URGENT') return ops.priUrgent
  if (priority === 'HIGH') return ops.priHigh
  if (priority === 'NORMAL') return ops.priNormal
  return ops.priLow
}

/** Inspection result → tone pill. Physical verdict, readable at a glance. */
function findingTone(result: string): string {
  if (result === 'PASS') return `${ops.tag} ${ops.tagOk}`
  if (result === 'DAMAGED' || result === 'DEFECTIVE' || result === 'UNSELLABLE') {
    return `${ops.tag} ${ops.tagBad}`
  }
  return `${ops.tag} ${ops.tagWarn}`
}

/** Disposition action → tone pill. Green only for back-to-shelf. */
function dispositionTone(action: string): string {
  if (action === 'RESTOCK') return `${ops.tag} ${ops.tagOk}`
  if (action === 'DISPOSE') return `${ops.tag} ${ops.tagBad}`
  if (action === 'REPAIR') return `${ops.tag} ${ops.tagWarn}`
  if (action === 'RECYCLE') return `${ops.tag} ${ops.tagMuted}`
  return `${ops.tag} ${ops.tagInfo}`
}

interface FindingDraft {
  result: string;
  productCondition: string;
  packagingCondition: string;
  quantity: number;
  damageNotes: string;
  missingComponents: string;
  serialNumber: string;
}

function blankFinding(quantity: number): FindingDraft {
  return {
    result: 'PASS',
    productCondition: 'LIKE_NEW',
    packagingCondition: 'NEW',
    quantity,
    damageNotes: '',
    missingComponents: '',
    serialNumber: '',
  }
}

interface DispositionDraft {
  action: string;
  quantity: number;
  locationId: string;
  reason: string;
  notes: string;
  recoveryRupees: string;
}

export default function WarehouseReturnDetail() {
  const { id } = useParams()
  const [detail, setDetail] = useState<WarehouseReturnDetail | null>(null)
  const [locations, setLocations] = useState<WarehouseContext['locations']>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Receiving form state.
  const [packageCondition, setPackageCondition] = useState<string>('SEALED')
  const [discrepancy, setDiscrepancy] = useState<string>('NONE')
  const [receivedQuantity, setReceivedQuantity] = useState('')
  const [trackingNumber, setTrackingNumber] = useState('')
  const [carrier, setCarrier] = useState('')
  const [receiveLocation, setReceiveLocation] = useState('')
  const [receiveNotes, setReceiveNotes] = useState('')

  // Inspection findings, keyed by return-item id.
  const [findings, setFindings] = useState<Record<string, FindingDraft>>({})
  const [inspectionNotes, setInspectionNotes] = useState('')

  // Per-line disposition drafts, keyed by return-item id.
  const [dispositions, setDispositions] = useState<Record<string, DispositionDraft>>({})

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
      const [data, context] = await Promise.all([
        wh<WarehouseReturnDetail>(`/returns/${id}`),
        wh<WarehouseContext>('/me'),
      ])
      setDetail(data)
      setLocations(context.locations)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true)
      } else {
        setError(friendlyMessage(err))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function run(): Promise<void> {
      if (!id) {
        if (!cancelled) {
          setNotFound(true)
          setLoading(false)
        }
        return
      }
      if (!cancelled) {
        setLoading(true)
        setError(null)
        setNotFound(false)
      }
      try {
        const [data, context] = await Promise.all([
          wh<WarehouseReturnDetail>(`/returns/${id}`),
          wh<WarehouseContext>('/me'),
        ])
        if (!cancelled) {
          setDetail(data)
          setLocations(context.locations)
        }
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true)
        } else {
          setError(friendlyMessage(err))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attempt])

  const summary = detail?.summary ?? null
  const lines = useMemo(() => detail?.lines ?? [], [detail])
  const disposedIds = useMemo(
    () => new Set((detail?.dispositions ?? []).map((row) => row.return_item_id)),
    [detail],
  )
  const approved = useMemo(() => {
    if ((detail?.audit ?? []).some((entry) => entry.action === 'RETURN_APPROVED')) return true;
    // Every path that stamps approved_at also writes an APPROVED timeline
    // event in the same transaction (scheduler, approve endpoint), and the
    // startup backfill derives the stamp from that event — so the
    // customer-visible timeline is an equivalent signal with no extra fetch.
    return (detail?.timeline ?? []).some((event) => event.status === 'APPROVED');
  }, [detail])
  const inspectionComplete = detail?.inspection?.inspection.completed_at != null
  const pendingLines = useMemo(() => lines.filter((line) => !disposedIds.has(line.returnItemId)), [lines, disposedIds])
  const allDisposed = lines.length > 0 && pendingLines.length === 0
  const terminal = summary?.status === 'RESOLVED' || summary?.status === 'CANCELLED'
  const heldForApproval = allDisposed && !approved && !terminal

  // Seed finding drafts for lines that have none yet (never clobbers edits).
  useEffect(() => {
    if (!detail?.inspection || inspectionComplete) return
    setFindings((prev) => {
      const next = { ...prev }
      let changed = false
      for (const line of lines) {
        if (!next[line.returnItemId]) {
          next[line.returnItemId] = blankFinding(line.quantity)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [detail, lines, inspectionComplete])

  // Seed disposition drafts for pending lines (never clobbers edits).
  useEffect(() => {
    if (!inspectionComplete) return
    const allowed = detail?.inspection?.allowedDispositions ?? {}
    setDispositions((prev) => {
      const next = { ...prev }
      let changed = false
      for (const line of pendingLines) {
        if (!next[line.returnItemId]) {
          const options = allowed[line.returnItemId] ?? [...ALL_DISPOSITIONS]
          next[line.returnItemId] = {
            action: options[0] ?? 'RESTOCK',
            quantity: line.quantity,
            locationId: '',
            reason: '',
            notes: '',
            recoveryRupees: '',
          }
          changed = true
        }
      }
      return changed ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectionComplete, detail, pendingLines.map((line) => line.returnItemId).join(',')])

  async function runAction(key: string, path: string, body?: unknown): Promise<void> {
    if (!id) return
    setBusy(key)
    setFormError(null)
    try {
      await wh(`/returns/${id}${path}`, { method: 'POST', body })
      await load()
    } catch (err) {
      setFormError(friendlyMessage(err))
    } finally {
      setBusy(null)
    }
  }

  function submitReceive(event: FormEvent): void {
    event.preventDefault()
    const totalQty = lines.reduce((sum, line) => sum + line.quantity, 0)
    void runAction('receive', '/receive', {
      packageCondition,
      discrepancy,
      receivedQuantity: receivedQuantity === '' ? totalQty : Number(receivedQuantity),
      trackingNumber: nullIfEmpty(trackingNumber),
      carrier: nullIfEmpty(carrier),
      locationId: receiveLocation === '' ? null : receiveLocation,
      notes: nullIfEmpty(receiveNotes),
    })
  }

  function submitCompleteInspection(event: FormEvent): void {
    event.preventDefault()
    void runAction('complete-inspection', '/inspection/complete', {
      findings: lines.map((line) => {
        const draft = findings[line.returnItemId] ?? blankFinding(line.quantity)
        return {
          returnItemId: line.returnItemId,
          result: draft.result,
          productCondition: draft.productCondition,
          packagingCondition: draft.packagingCondition,
          quantity: Number(draft.quantity),
          missingComponents: nullIfEmpty(draft.missingComponents),
          damageNotes: nullIfEmpty(draft.damageNotes),
          serialNumber: nullIfEmpty(draft.serialNumber),
        }
      }),
      notes: nullIfEmpty(inspectionNotes),
    })
  }

  function submitDisposition(event: FormEvent, line: WarehouseReturnLine): void {
    event.preventDefault()
    const draft = dispositions[line.returnItemId]
    if (!draft) return
    const recovery = draft.recoveryRupees.trim() === '' ? undefined : Math.round(Number(draft.recoveryRupees) * 100)
    void runAction(`dispose-${line.returnItemId}`, '/disposition', {
      returnItemId: line.returnItemId,
      action: draft.action,
      quantity: Number(draft.quantity),
      locationId: draft.locationId === '' ? null : draft.locationId,
      reason: nullIfEmpty(draft.reason),
      notes: nullIfEmpty(draft.notes),
      ...(recovery !== undefined && Number.isFinite(recovery) ? { recoveryValuePaise: recovery } : {}),
    })
  }

  function patchFinding(returnItemId: string, patch: Partial<FindingDraft>): void {
    setFindings((prev) => ({
      ...prev,
      [returnItemId]: { ...(prev[returnItemId] ?? blankFinding(1)), ...patch },
    }))
  }

  function patchDisposition(returnItemId: string, patch: Partial<DispositionDraft>): void {
    setDispositions((prev) => {
      const current = prev[returnItemId]
      if (!current) return prev
      return { ...prev, [returnItemId]: { ...current, ...patch } }
    })
  }

  if (loading) {
    return (
      <div>
        <PageHead kicker="Floor" title="Return detail" lede="Loading the return file." />
        <LoadingState label="Loading return…" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div>
        <PageHead kicker="Floor" title="Return detail" lede="Check the link and try again." />
        <ErrorState message="Return not found in this warehouse." />
      </div>
    )
  }

  if (error || !detail || !summary) {
    return (
      <div>
        <PageHead kicker="Floor" title="Return detail" lede="Check the link and try again." />
        <ErrorState message={error ?? 'Return could not be loaded.'} onRetry={() => setAttempt((v) => v + 1)} />
      </div>
    )
  }

  const stages = [
    { label: 'Approved', done: approved },
    { label: 'Received', done: detail.receiving !== null },
    { label: 'Inspected', done: inspectionComplete },
    { label: 'Dispositioned', done: allDisposed },
    { label: 'Resolved', done: summary.status === 'RESOLVED' },
  ]
  const currentStage = stages.findIndex((stage) => !stage.done)
  const doneCount = stages.filter((stage) => stage.done).length

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Floor"
        title={summary.returnNumber}
        lede={`${summary.productName ?? 'Return file'} · ${summary.orderNumber ?? summary.orderId}`}
        actions={<Link to="/warehouse/returns">Back to queue</Link>}
      />

      <section className={ops.panel} aria-label="Return facts">
        <div className={styles.facts}>
          <Fact label="Status">
            <StatusBadge tone={statusTone(summary.status)}>{summary.status.replaceAll('_', ' ')}</StatusBadge>
          </Fact>
          <Fact label="Priority">
            <span className={`${ops.pri} ${priorityClass(summary.priority)}`}>{summary.priority}</span>
            {summary.overdue && (
              <>
                {' '}
                <span className={ops.flagOverdue}>OVERDUE</span>
              </>
            )}
          </Fact>
          <Fact label="Resolution" mono>{summary.resolutionType ?? '—'}</Fact>
          <Fact label="Customer ref" mono>{summary.customerRef}</Fact>
          <Fact label="Carrier" mono>
            {summary.carrier ?? '—'}
            {summary.trackingNumber ? ` · ${summary.trackingNumber}` : ''}
          </Fact>
          <Fact label="Age" mono>
            {Number.isFinite(summary.ageHours) ? `${Math.floor(summary.ageHours)}h` : '—'}
          </Fact>
          <Fact label="Lines" mono>
            {summary.dispositionsDone}/{summary.lineCount} dispositioned
          </Fact>
        </div>
        <ol className={styles.stages} aria-label="Workflow progress">
          {stages.map((stage, index) => (
            <li
              key={stage.label}
              className={`${styles.stage} ${stage.done ? styles.stageDone : ''} ${index === currentStage ? styles.stageCurrent : ''}`}
              aria-current={index === currentStage ? 'step' : undefined}
            >
              <span className={styles.stageDot} aria-hidden="true">
                {stage.done ? '✓' : index + 1}
              </span>
              {stage.label}
            </li>
          ))}
        </ol>
        <div className={styles.stageTrack} aria-hidden="true">
          <div className={styles.stageFill} style={{ width: `${(doneCount / stages.length) * 100}%` }} />
        </div>
      </section>

      {summary.status === 'RESOLVED' && (
        <p className={styles.bannerOk} role="status">
          Resolved. The financial outcome (credit / refund / replacement order) has been applied — see the audit trail below.
        </p>
      )}
      {summary.status === 'CANCELLED' && (
        <p className={styles.bannerMuted} role="status">
          Cancelled by the customer. No floor work remains.
        </p>
      )}
      {heldForApproval && (
        <p className={styles.bannerWarn} role="alert">
          Goods are dispositioned but the claim was never approved — payout is held. Approve below to release it.
        </p>
      )}
      {formError && (
        <p className={styles.bannerBad} role="alert">
          {formError}
        </p>
      )}

      {!terminal && !approved && (
        <section className={ops.panel} aria-labelledby="approve-h">
          <h2 className={ops.panelTitle} id="approve-h">1 · Approve the claim</h2>
          <p className={ops.muted}>
            Approval accepts the claim. Nothing pays out before this stamp — receiving and inspection can proceed either way.
          </p>
          <div className={ops.btnRow}>
            <button
              type="button"
              className={`${ops.btn} ${ops.btnPrimary}`}
              disabled={busy !== null}
              onClick={() => void runAction('approve', '/approve', {})}
            >
              {busy === 'approve' ? 'Approving…' : 'Approve return'}
            </button>
          </div>
        </section>
      )}

      {!terminal && !detail.receiving && (
        <section className={ops.panel} aria-labelledby="receive-h">
          <h2 className={ops.panelTitle} id="receive-h">2 · Receive the parcel</h2>
          <form onSubmit={submitReceive}>
            <div className={ops.formGrid}>
              <label className={ops.field}>
                <span className={ops.label}>Package condition</span>
                <select className={ops.select} value={packageCondition} onChange={(e) => setPackageCondition(e.target.value)}>
                  {PACKAGE_CONDITIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className={ops.field}>
                <span className={ops.label}>Discrepancy</span>
                <select className={ops.select} value={discrepancy} onChange={(e) => setDiscrepancy(e.target.value)}>
                  {RECEIVING_DISCREPANCIES.map((option) => (
                    <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>
                  ))}
                </select>
              </label>
              <label className={ops.field}>
                <span className={ops.label}>Received quantity</span>
                <input
                  className={ops.input}
                  type="number"
                  min={0}
                  placeholder={String(lines.reduce((sum, line) => sum + line.quantity, 0))}
                  value={receivedQuantity}
                  onChange={(e) => setReceivedQuantity(e.target.value)}
                />
              </label>
              <label className={ops.field}>
                <span className={ops.label}>Put-away location (optional)</span>
                <select className={ops.select} value={receiveLocation} onChange={(e) => setReceiveLocation(e.target.value)}>
                  <option value="">No location</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code} · {location.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={ops.field}>
                <span className={ops.label}>Tracking number (optional)</span>
                <input
                  className={ops.input}
                  type="text"
                  placeholder={summary.trackingNumber ?? ''}
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  maxLength={80}
                />
              </label>
              <label className={ops.field}>
                <span className={ops.label}>Carrier (optional)</span>
                <input
                  className={ops.input}
                  type="text"
                  placeholder={summary.carrier ?? ''}
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  maxLength={80}
                />
              </label>
              <label className={`${ops.field} ${ops.fieldFull}`}>
                <span className={ops.label}>Notes (optional)</span>
                <textarea className={ops.textarea} value={receiveNotes} onChange={(e) => setReceiveNotes(e.target.value)} maxLength={2000} rows={2} />
              </label>
            </div>
            <div className={ops.btnRow}>
              <button type="submit" className={`${ops.btn} ${ops.btnPrimary}`} disabled={busy !== null}>
                {busy === 'receive' ? 'Receiving…' : 'Record receipt'}
              </button>
            </div>
          </form>
        </section>
      )}

      {!terminal && detail.receiving && !detail.inspection && (
        <section className={ops.panel} aria-labelledby="inspect-start-h">
          <h2 className={ops.panelTitle} id="inspect-start-h">3 · Inspect</h2>
          <p className={ops.muted}>Received {formatDate(detail.receiving.created_at)}. Start the inspection to move the goods to the bench.</p>
          <div className={ops.btnRow}>
            <button
              type="button"
              className={`${ops.btn} ${ops.btnPrimary}`}
              disabled={busy !== null}
              onClick={() => void runAction('inspect-start', '/inspection/start', {})}
            >
              {busy === 'inspect-start' ? 'Starting…' : 'Start inspection'}
            </button>
          </div>
        </section>
      )}

      {detail.inspection && !inspectionComplete && (
        <section className={ops.panel} aria-labelledby="inspect-h">
          <h2 className={ops.panelTitle} id="inspect-h">3 · Record findings (one per line)</h2>
          <form onSubmit={submitCompleteInspection}>
            {lines.map((line) => {
              const draft = findings[line.returnItemId] ?? blankFinding(line.quantity)
              return (
                <fieldset key={line.returnItemId} className={styles.finding}>
                  <legend className={styles.findingTitle}>
                    {line.productName} · {line.sku} × {line.quantity}
                  </legend>
                  <div className={ops.formGrid}>
                    <label className={ops.field}>
                      <span className={ops.label}>Result</span>
                      <select
                        className={ops.select}
                        value={draft.result}
                        onChange={(e) => patchFinding(line.returnItemId, { result: e.target.value })}
                      >
                        {INSPECTION_RESULTS.map((option) => (
                          <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>
                        ))}
                      </select>
                    </label>
                    <label className={ops.field}>
                      <span className={ops.label}>Quantity inspected</span>
                      <input
                        className={ops.input}
                        type="number"
                        min={1}
                        max={line.quantity}
                        value={draft.quantity}
                        onChange={(e) => patchFinding(line.returnItemId, { quantity: Number(e.target.value) })}
                      />
                    </label>
                    <label className={ops.field}>
                      <span className={ops.label}>Product condition</span>
                      <select
                        className={ops.select}
                        value={draft.productCondition}
                        onChange={(e) => patchFinding(line.returnItemId, { productCondition: e.target.value })}
                      >
                        {CONDITION_GRADES.map((option) => (
                          <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>
                        ))}
                      </select>
                    </label>
                    <label className={ops.field}>
                      <span className={ops.label}>Packaging condition</span>
                      <select
                        className={ops.select}
                        value={draft.packagingCondition}
                        onChange={(e) => patchFinding(line.returnItemId, { packagingCondition: e.target.value })}
                      >
                        {CONDITION_GRADES.map((option) => (
                          <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>
                        ))}
                      </select>
                    </label>
                    <label className={ops.field}>
                      <span className={ops.label}>Damage notes (optional)</span>
                      <input
                        className={ops.input}
                        type="text"
                        value={draft.damageNotes}
                        onChange={(e) => patchFinding(line.returnItemId, { damageNotes: e.target.value })}
                        maxLength={2000}
                      />
                    </label>
                    <label className={ops.field}>
                      <span className={ops.label}>Serial / missing parts (optional)</span>
                      <input
                        className={ops.input}
                        type="text"
                        value={draft.serialNumber}
                        onChange={(e) => patchFinding(line.returnItemId, { serialNumber: e.target.value })}
                        maxLength={120}
                        placeholder="Serial, or missing components"
                      />
                    </label>
                  </div>
                </fieldset>
              )
            })}
            <label className={`${ops.field} ${styles.notesField}`}>
              <span className={ops.label}>Inspection notes (optional)</span>
              <textarea className={ops.textarea} value={inspectionNotes} onChange={(e) => setInspectionNotes(e.target.value)} maxLength={2000} rows={2} />
            </label>
            <div className={ops.btnRow}>
              <button type="submit" className={`${ops.btn} ${ops.btnPrimary}`} disabled={busy !== null}>
                {busy === 'complete-inspection' ? 'Completing…' : 'Complete inspection'}
              </button>
            </div>
          </form>
        </section>
      )}

      {inspectionComplete && pendingLines.length > 0 && !terminal && (
        <section className={ops.panel} aria-labelledby="dispose-h">
          <h2 className={ops.panelTitle} id="dispose-h">4 · Disposition ({pendingLines.length} line(s) left)</h2>
          {pendingLines.map((line) => {
            const allowed = detail.inspection?.allowedDispositions[line.returnItemId] ?? [...ALL_DISPOSITIONS]
            const draft = dispositions[line.returnItemId]
            if (!draft) return null
            return (
              <form key={line.returnItemId} className={styles.disposeForm} onSubmit={(e) => submitDisposition(e, line)}>
                <h3 className={styles.disposeTitle}>
                  {line.productName} · {line.sku} × {line.quantity}
                </h3>
                <div className={ops.formGrid}>
                  <label className={ops.field}>
                    <span className={ops.label}>Action (per inspection)</span>
                    <select
                      className={ops.select}
                      value={draft.action}
                      onChange={(e) => patchDisposition(line.returnItemId, { action: e.target.value })}
                    >
                      {allowed.map((option) => (
                        <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>
                      ))}
                    </select>
                  </label>
                  <label className={ops.field}>
                    <span className={ops.label}>Quantity</span>
                    <input
                      className={ops.input}
                      type="number"
                      min={1}
                      max={line.quantity}
                      value={draft.quantity}
                      onChange={(e) => patchDisposition(line.returnItemId, { quantity: Number(e.target.value) })}
                    />
                  </label>
                  <label className={ops.field}>
                    <span className={ops.label}>Target location (optional)</span>
                    <select
                      className={ops.select}
                      value={draft.locationId}
                      onChange={(e) => patchDisposition(line.returnItemId, { locationId: e.target.value })}
                    >
                      <option value="">No location</option>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.code} · {location.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={ops.field}>
                    <span className={ops.label}>Recovery value ₹ (optional)</span>
                    <input
                      className={ops.input}
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="0.00"
                      value={draft.recoveryRupees}
                      onChange={(e) => patchDisposition(line.returnItemId, { recoveryRupees: e.target.value })}
                    />
                  </label>
                  <label className={`${ops.field} ${ops.fieldFull}`}>
                    <span className={ops.label}>Reason / notes (optional)</span>
                    <input
                      className={ops.input}
                      type="text"
                      value={draft.reason}
                      onChange={(e) => patchDisposition(line.returnItemId, { reason: e.target.value })}
                      maxLength={500}
                      placeholder="Reason, extra notes"
                    />
                  </label>
                </div>
                <div className={ops.btnRow}>
                  <button
                    type="submit"
                    className={`${ops.btn} ${ops.btnPrimary}`}
                    disabled={busy !== null}
                  >
                    {busy === `dispose-${line.returnItemId}` ? 'Recording…' : `Record ${draft.action.replaceAll('_', ' ')}`}
                  </button>
                </div>
              </form>
            )
          })}
        </section>
      )}

      <section className={ops.panel} aria-label="Returned lines">
        <h2 className={ops.panelTitle}>Lines</h2>
        <div className={ops.tableWrap}>
          <table className={ops.table}>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Qty</th>
                <th scope="col">Reason</th>
                <th scope="col">Finding</th>
                <th scope="col">Disposition</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const finding = detail.inspection?.items.find((item) => item.return_item_id === line.returnItemId)
                const disposition = detail.dispositions.find((row) => row.return_item_id === line.returnItemId)
                return (
                  <tr key={line.returnItemId}>
                    <td>
                      {line.productName}
                      <div className={ops.muted}>{line.sku}</div>
                    </td>
                    <td className={ops.mono}>{line.quantity}</td>
                    <td className={ops.mono}>{line.reasonCode}</td>
                    <td>
                      {finding ? (
                        <span className={findingTone(finding.result)}>{finding.result.replaceAll('_', ' ')}</span>
                      ) : (
                        <span className={ops.muted}>—</span>
                      )}
                    </td>
                    <td>
                      {disposition ? (
                        <span className={dispositionTone(disposition.action)}>
                          {disposition.action.replaceAll('_', ' ')} × {disposition.quantity}
                        </span>
                      ) : (
                        <span className={ops.muted}>—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className={styles.twoCol}>
        <section className={ops.panel} aria-label="Customer-visible timeline">
          <h2 className={ops.panelTitle}>Timeline</h2>
          {detail.timeline.length === 0 ? (
            <p className={ops.muted}>No events yet.</p>
          ) : (
            <ol className={styles.timeline}>
              {detail.timeline.map((event) => (
                <li key={event.id} className={styles.timelineItem}>
                  <span className={styles.timelineStatus}>{event.status.replaceAll('_', ' ')}</span>
                  <span className={styles.timelineDate}>{formatDate(event.created_at)}</span>
                  {event.description && <span className={styles.timelineDesc}>{event.description}</span>}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className={ops.panel} aria-label="Audit trail">
          <h2 className={ops.panelTitle}>Audit (read-only)</h2>
          {detail.audit.length === 0 ? (
            <p className={ops.muted}>No floor actions recorded yet.</p>
          ) : (
            <ol className={styles.timeline}>
              {detail.audit.map((entry) => (
                <li key={entry.id} className={styles.timelineItem}>
                  <span className={styles.timelineStatus}>{entry.action.replaceAll('_', ' ')}</span>
                  <span className={styles.timelineDate}>
                    {formatDate(entry.created_at)} · {entry.actor_role}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {detail.dispositions.length > 0 && (
        <section className={ops.panel} aria-label="Dispositions">
          <h2 className={ops.panelTitle}>Dispositions</h2>
          <div className={ops.tableWrap}>
            <table className={ops.table}>
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Recovery</th>
                  <th scope="col">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {detail.dispositions.map((row: DispositionRow) => (
                  <tr key={row.id}>
                    <td className={ops.mono}>{row.action.replaceAll('_', ' ')}</td>
                    <td className={ops.mono}>{row.quantity}</td>
                    <td className={ops.mono}>{formatMoneyPaise(row.recovery_value_paise)}</td>
                    <td className={ops.mono}>{formatDate(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {detail.documents.length > 0 && (
        <section className={ops.panel} aria-label="Customer evidence">
          <h2 className={ops.panelTitle}>Evidence ({detail.documents.length})</h2>
          <ul className={styles.docList}>
            {detail.documents.map((doc) => (
              <li key={doc.id} className={styles.docRow}>
                <span className={ops.mono}>{doc.kind}</span>
                <span>{doc.filename}</span>
                <span className={ops.muted}>{formatDate(doc.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
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
