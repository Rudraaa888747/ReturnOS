import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useAsync } from '../../hooks/useAsync'
import { ApiRequestError, errorMessage } from '../../lib/api'
import { dateTime, dispositionLabel, money, returnReasonLabel } from '../../lib/format'
import {
  approveReturn,
  assessRisk,
  evaluateDisposition,
  finalizeDisposition,
  getDisposition,
  getExecution,
  getInspection,
  getReturn,
  getRisk,
  overrideDisposition,
  receiveReturn,
  rejectReturn,
  submitInspection,
  type InspectionInput,
} from '../../services/returns'
import {
  acknowledgeVendorClaim,
  approveVendorClaim,
  completeDisposal,
  completeExecution,
  completeTask,
  correctRecovery,

  createTask,
  failExecution,
  getHistory,
  getRecovery,
  getVendorClaim,
  listRecovery,
  listTasks,
  openRecovery,
  openVendorClaim,
  recordRestock,
  rejectVendorClaim,
  sellRecovery,
  settleRecovery,
  settleVendorClaim,
  startExecution,
  startTask,
  submitVendorClaim,
} from '../../services/operations'
import type {
  Disposition,
  DispositionEvaluation,
  Execution,
  Inspection,
  OpsTask,
  RecoveryRecord,
  ReturnHistory,
  ReturnOrder,
  RiskAssessment,
  VendorClaim,
} from '../../lib/types'
import {
  Badge,
  Button,
  Field,
  InlineSpinner,
  LoadError,
  PageHead,
  Panel,
  SelectInput,
  Skeleton,
  TextArea,
  TextInput,
} from '../../components/ui'
import ui from '../../components/ui.module.css'
import { ConfirmDialog, useToast } from '../../components/feedback'
import {
  DispositionMark,
  ExecutionBadge,
  InspectionSummaryLine,
  RecoveryBadge,
  ReturnBadge,
  RiskBadge,
  VendorBadge,
  TaskBadge,
} from '../../components/status'
import { CandidateList } from '../../components/visuals'

/* ---------- aggregate loading: one refresh point for every mutation ---------- */

interface WorkspaceData {
  ret: ReturnOrder
  history: ReturnHistory
  inspection: Inspection | null
  risk: RiskAssessment | null
  disposition: DispositionEvaluation | null
  execution: Execution | null
  vendor: VendorClaim | null
  recovery: RecoveryRecord | null
  tasks: OpsTask[]
}

async function nullOn404<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) return null
    throw e
  }
}

async function loadWorkspace(id: string): Promise<WorkspaceData> {
  const [ret, history] = await Promise.all([getReturn(id), getHistory(id)])
  const [inspection, risk, disposition, execution, tasks] = await Promise.all([
    nullOn404(() => getInspection(id)),
    nullOn404(() => getRisk(id)),
    nullOn404(() => getDisposition(id)),
    nullOn404(() => getExecution(id)),
    listTasks({ returnId: id, page: 0, size: 50 }).then((p) => p.content),
  ])
  const [vendor, recovery] = await Promise.all([
    execution ? nullOn404(() => getVendorClaim(id)) : null,
    execution ? nullOn404(() => getRecovery(id)) : null,
  ])
  return { ret, history, inspection, risk, disposition, execution, vendor, recovery, tasks }
}

type Runner = (fn: () => Promise<unknown>, ok: string) => Promise<void>

/* ---------- page ---------- */

export default function Workspace() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const notify = useToast()
  const isAdmin = user?.role === 'ADMIN'
  const { data, error, loading, reload } = useAsync(() => loadWorkspace(id), [id])

  const run: Runner = async (fn, ok) => {
    try {
      await fn()
      notify(ok)
      reload()
    } catch (err) {
      notify(errorMessage(err), 'error')
    }
  }

  if (loading) {
    return (
      <>
        <Skeleton width={220} height={26} />
        <div style={{ height: 'var(--sp-4)' }} />
        <Skeleton height={200} />
      </>
    )
  }
  if (error || !data) return <LoadError error={error ?? 'Return not found.'} onRetry={reload} />

  const { ret } = data
  return (
    <>
      <PageHead
        title={ret.returnNumber}
        intro={`Requested ${dateTime(ret.requestedAt)} · ${ret.items.length} item${ret.items.length === 1 ? '' : 's'}`}
        actions={<ReturnBadge status={ret.status} />}
      />
      <NextActionBar data={data} run={run} />
      <StatusPanel ret={ret} run={run} />
      <InspectionSection data={data} run={run} />
      <RiskSection data={data} run={run} />
      <DispositionSection data={data} run={run} isAdmin={isAdmin} />
      <ExecutionSection data={data} run={run} isAdmin={isAdmin} />
      <TasksSection returnId={id} tasks={data.tasks} run={run} />
      <HistoryPanel data={data} />
      <p style={{ marginTop: 'var(--sp-4)' }}>
        <Link to="/ops/returns">← Back to work queue</Link>
      </p>
    </>
  )
}

/* ---------- next action ---------- */

function NextActionBar({ data, run }: { data: WorkspaceData; run: Runner }) {
  const { ret, inspection, risk, disposition, execution } = data
  let lead = ''
  let action: { label: string; run: () => Promise<void> } | null = null

  if (ret.status === 'REQUESTED') {
    lead = 'Decide: does this return meet policy? Approve it or reject with a reason below.'
    action = { label: 'Approve return', run: () => run(() => approveReturn(ret.id), 'Return approved.') }
  } else if (ret.status === 'APPROVED') {
    lead = 'Approved. If the customer hands it over in person, receive the counter drop-off below.'
  } else if (ret.status === 'IN_TRANSIT') {
    lead = 'Parcel is moving. When it lands, receive it as a carrier shipment.'
    action = { label: 'Receive shipment', run: () => run(() => receiveReturn(ret.id, 'SHIPPED'), 'Return received.') }
  } else if (ret.status === 'RECEIVED' || ret.status === 'INSPECTION_PENDING') {
    lead = 'On the bench. Record the inspection to move forward.'
  } else if (!inspection) {
    lead = 'Inspection data missing — record it to continue.'
  } else if (!risk) {
    lead = 'Inspected. Assess risk to understand exposure.'
    action = { label: 'Assess risk', run: () => run(() => assessRisk(ret.id), 'Risk assessed.') }
  } else if (!disposition) {
    lead = `Risk is ${risk.level.toLowerCase()} (${risk.score}). Evaluate disposition next.`
    action = { label: 'Evaluate disposition', run: () => run(() => evaluateDisposition(ret.id), 'Disposition evaluated.') }
  } else if (!disposition.finalDisposition) {
    lead = `${dispositionLabel[disposition.recommended]} recommended — record the final decision below.`
  } else if (!execution || execution.status === 'PENDING') {
    lead = `Final: ${dispositionLabel[disposition.finalDisposition]}. Start execution to do the work.`
    action = { label: 'Start execution', run: () => run(() => startExecution(ret.id), 'Execution started.') }
  } else if (execution.status === 'IN_PROGRESS') {
    lead = 'Work in progress — complete the channel step, then finish execution.'
  } else if (execution.status === 'FAILED') {
    lead = `Execution failed: ${execution.failureReason ?? 'no reason recorded'}.`
  } else {
    lead = 'Operationally complete. History below tells the full story.'
  }

  return (
    <div className={ui.actionBar}>
      <span style={{ marginRight: 'auto', fontWeight: 600 }}>{lead}</span>
      {action && (
        <Button variant="primary" size="sm" onClick={() => void action.run()}>
          {action.label}
        </Button>
      )}
    </div>
  )
}

/* ---------- status + approve/reject/receive ---------- */

function StatusPanel({ ret, run }: { ret: ReturnOrder; run: Runner }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const doReject = async () => {
    if (reason.trim().length < 3) return
    setBusy(true)
    try {
      await run(() => rejectReturn(ret.id, reason.trim()), 'Return rejected.')
      setRejecting(false)
      setReason('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Return">
      <dl style={{ margin: 0 }}>
        {ret.items.map((i) => (
          <div className={ui.kv} key={i.id}>
            <dt>
              {i.quantity} × {i.sku}
            </dt>
            <dd>{returnReasonLabel[i.reason]}</dd>
          </div>
        ))}
        <div className={ui.kv}>
          <dt>Requested</dt>
          <dd className="data">{dateTime(ret.requestedAt)}</dd>
        </div>
        {ret.receivedAt && (
          <div className={ui.kv}>
            <dt>Received</dt>
            <dd className="data">{dateTime(ret.receivedAt)}</dd>
          </div>
        )}
        {ret.rejectionReason && (
          <div className={ui.kv}>
            <dt>Rejection note</dt>
            <dd>{ret.rejectionReason}</dd>
          </div>
        )}
      </dl>
      {ret.status === 'REQUESTED' && (
        <div style={{ marginTop: 'var(--sp-4)', display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <Button variant="primary" size="sm" onClick={() => void run(() => approveReturn(ret.id), 'Return approved.')}>
            Approve
          </Button>
          <Button size="sm" onClick={() => setRejecting((v) => !v)}>
            Reject…
          </Button>
        </div>
      )}
      {ret.status === 'REQUESTED' && rejecting && (
        <div style={{ marginTop: 'var(--sp-3)', display: 'flex', gap: 'var(--sp-2)' }}>
          <TextInput
            aria-label="Rejection reason"
            placeholder="Why is this return refused? (min 3 characters)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button variant="danger" size="sm" disabled={reason.trim().length < 3 || busy} onClick={() => void doReject()}>
            {busy ? '…' : 'Confirm'}
          </Button>
        </div>
      )}
      {ret.status === 'APPROVED' && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <Button
            size="sm"
            onClick={() => void run(() => receiveReturn(ret.id, 'COUNTER'), 'Counter drop-off received.')}
          >
            Receive counter drop-off
          </Button>
        </div>
      )}
      {ret.status === 'IN_TRANSIT' && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void run(() => receiveReturn(ret.id, 'SHIPPED'), 'Shipment received.')}
          >
            Receive shipment
          </Button>
        </div>
      )}
    </Panel>
  )
}

/* ---------- inspection ---------- */

const PHYSICAL = ['EXCELLENT', 'GOOD', 'FAIR', 'DAMAGED']
const PACKAGING = ['SEALED', 'OPENED', 'DAMAGED', 'MISSING']
const FUNCTIONAL = ['PASSED', 'FAILED', 'NOT_TESTED']

function InspectionSection({ data, run }: { data: WorkspaceData; run: Runner }) {
  const { ret, inspection } = data
  const [form, setForm] = useState<InspectionInput>({
    physicalCondition: 'GOOD',
    packagingCondition: 'OPENED',
    accessoriesComplete: true,
    functionalTestResult: 'NOT_TESTED',
    visibleDamage: '',
    notes: '',
  })
  const [busy, setBusy] = useState(false)
  const canInspect = ['RECEIVED', 'INSPECTION_PENDING', 'INSPECTION_IN_PROGRESS'].includes(ret.status)

  if (inspection) {
    return (
      <Panel title="Inspection" sub={`Completed ${dateTime(inspection.inspectedAt)}`}>
        <p>
          <InspectionSummaryLine
            physical={inspection.physicalCondition}
            packaging={inspection.packagingCondition}
            functional={inspection.functionalTestResult}
          />
        </p>
        <dl style={{ margin: 'var(--sp-3) 0 0' }}>
          <div className={ui.kv}>
            <dt>Accessories</dt>
            <dd>{inspection.accessoriesComplete ? 'Complete' : 'Incomplete'}</dd>
          </div>
          {inspection.visibleDamage && (
            <div className={ui.kv}>
              <dt>Visible damage</dt>
              <dd>{inspection.visibleDamage}</dd>
            </div>
          )}
          {inspection.notes && (
            <div className={ui.kv}>
              <dt>Notes</dt>
              <dd>{inspection.notes}</dd>
            </div>
          )}
        </dl>
      </Panel>
    )
  }

  if (!canInspect) return null
  return (
    <Panel title="Inspection" sub="Record what is on the bench. Be precise — disposition depends on this.">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setBusy(true)
          void (async () => {
            try {
              await run(
                () =>
                  submitInspection(ret.id, {
                    ...form,
                    visibleDamage: form.visibleDamage || undefined,
                    notes: form.notes || undefined,
                  }),
                'Inspection recorded.',
              )
            } finally {
              setBusy(false)
            }
          })()
        }}
      >
        <div className={ui.grid2}>
          <Field label="Physical condition" htmlFor="insp-phys">
            <SelectInput
              id="insp-phys"
              value={form.physicalCondition}
              onChange={(e) => setForm({ ...form, physicalCondition: e.target.value })}
            >
              {PHYSICAL.map((v) => (
                <option key={v} value={v}>
                  {v.charAt(0) + v.slice(1).toLowerCase()}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Packaging" htmlFor="insp-pack">
            <SelectInput
              id="insp-pack"
              value={form.packagingCondition}
              onChange={(e) => setForm({ ...form, packagingCondition: e.target.value })}
            >
              {PACKAGING.map((v) => (
                <option key={v} value={v}>
                  {v.charAt(0) + v.slice(1).toLowerCase()}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <div className={ui.grid2}>
          <Field label="Functional test" htmlFor="insp-func">
            <SelectInput
              id="insp-func"
              value={form.functionalTestResult}
              onChange={(e) => setForm({ ...form, functionalTestResult: e.target.value })}
            >
              {FUNCTIONAL.map((v) => (
                <option key={v} value={v}>
                  {v.replace(/_/g, ' ').charAt(0) + v.replace(/_/g, ' ').slice(1).toLowerCase()}
                </option>
              ))}
            </SelectInput>
          </Field>
          <label className={ui.checkRow} style={{ marginTop: '1.4rem' }}>
            <input
              type="checkbox"
              checked={form.accessoriesComplete}
              onChange={(e) => setForm({ ...form, accessoriesComplete: e.target.checked })}
            />
            Accessories complete
          </label>
        </div>
        <Field label="Visible damage (optional)" htmlFor="insp-dmg">
          <TextInput
            id="insp-dmg"
            value={form.visibleDamage}
            onChange={(e) => setForm({ ...form, visibleDamage: e.target.value })}
            placeholder="e.g. cracked rear casing"
          />
        </Field>
        <Field label="Notes (optional)" htmlFor="insp-notes">
          <TextArea
            id="insp-notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Anything the next operator should know"
          />
        </Field>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? <InlineSpinner label="Saving…" /> : 'Complete inspection'}
        </Button>
      </form>
    </Panel>
  )
}

/* ---------- risk ---------- */

function RiskSection({ data, run }: { data: WorkspaceData; run: Runner }) {
  const { ret, inspection, risk } = data
  if (!inspection) return null
  return (
    <Panel title="Risk" sub="Operational attention signal — never a fraud accusation.">
      {!risk ? (
        <Button size="sm" variant="primary" onClick={() => void run(() => assessRisk(ret.id), 'Risk assessed.')}>
          Assess risk
        </Button>
      ) : (
        <>
          <p style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span className="data" style={{ fontSize: 'var(--fs-metric)', fontWeight: 600 }}>
              {risk.score}
            </span>
            <RiskBadge level={risk.level} showHint />
          </p>
          <ul style={{ margin: 'var(--sp-3) 0 0', paddingLeft: 'var(--sp-5)', fontSize: 'var(--fs-body)' }}>
            {risk.factors.map((f) => (
              <li key={f.ruleCode} style={{ marginBottom: 'var(--sp-1)' }}>
                <strong>+{f.points}</strong> · {f.explanation}
              </li>
            ))}
            {risk.factors.length === 0 && <li className="meta">No risk signals fired for this return.</li>}
          </ul>
        </>
      )}
    </Panel>
  )
}

/* ---------- disposition ---------- */

function DispositionSection({
  data,
  run,
  isAdmin,
}: {
  data: WorkspaceData
  run: Runner
  isAdmin: boolean
}) {
  const { ret, inspection, disposition } = data
  const [choice, setChoice] = useState<Disposition | ''>('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  if (!inspection) return null

  const finalize = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await run(
        () =>
          finalizeDisposition(
            ret.id,
            choice === '' ? undefined : choice,
            reason.trim() === '' ? undefined : reason.trim(),
          ),
        'Final disposition recorded.',
      )
      setChoice('')
      setReason('')
    } finally {
      setBusy(false)
    }
  }

  const doOverride = async () => {
    if (choice === '' || reason.trim().length < 3) return
    setBusy(true)
    try {
      await run(() => overrideDisposition(ret.id, choice as Disposition, reason.trim()), 'Recommendation overridden.')
      setChoice('')
      setReason('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Disposition" sub="The engine recommends; a human decides.">
      {!disposition ? (
        <Button
          size="sm"
          variant="primary"
          onClick={() => void run(() => evaluateDisposition(ret.id), 'Disposition evaluated.')}
        >
          Evaluate disposition
        </Button>
      ) : (
        <>
          <p style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="eyebrow">Recommended</span>
            <DispositionMark value={disposition.recommended} />
            {disposition.finalDisposition && (
              <>
                <span className="meta">→ final:</span>
                <DispositionMark value={disposition.finalDisposition} />
                {disposition.overridden && <Badge tone="warn">Overridden</Badge>}
              </>
            )}
          </p>
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <CandidateList candidates={disposition.candidates} picked={disposition.recommended} />
          </div>
          {!disposition.finalDisposition && (
            <form onSubmit={finalize} style={{ marginTop: 'var(--sp-4)' }}>
              <div className={ui.grid2}>
                <Field
                  label="Final channel"
                  htmlFor="disp-choice"
                  hint={isAdmin ? undefined : 'Only admins can override the recommendation.'}
                >
                  <SelectInput
                    id="disp-choice"
                    value={choice === '' ? disposition.recommended : choice}
                    onChange={(e) => setChoice(e.target.value as Disposition)}
                  >
                    {disposition.candidates
                      .filter((c) => c.eligible)
                      .map((c) => (
                        <option
                          key={c.disposition}
                          value={c.disposition}
                          disabled={!isAdmin && c.disposition !== disposition.recommended}
                        >
                          {dispositionLabel[c.disposition]}
                          {c.disposition === disposition.recommended ? ' (recommended)' : ''}
                        </option>
                      ))}
                  </SelectInput>
                </Field>
                <Field
                  label="Override reason"
                  htmlFor="disp-reason"
                  hint="Required when the final channel differs from the recommendation."
                >
                  <TextInput
                    id="disp-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. refurb partner unavailable for this category"
                  />
                </Field>
              </div>
              <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                <Button variant="primary" type="submit" disabled={busy}>
                  {busy ? <InlineSpinner label="Recording…" /> : 'Record final disposition'}
                </Button>
                {isAdmin && (
                  <Button
                    type="button"
                    disabled={busy || choice === '' || choice === disposition.recommended || reason.trim().length < 3}
                    onClick={() => void doOverride()}
                  >
                    Override as admin
                  </Button>
                )}
              </div>
            </form>
          )}
          {disposition.finalDisposition && disposition.overridden && disposition.overrideReason && (
            <p className="meta" style={{ marginTop: 'var(--sp-3)' }}>
              Override reason: {disposition.overrideReason}
            </p>
          )}
        </>
      )}
    </Panel>
  )
}

/* ---------- execution + channels ---------- */

function ExecutionSection({
  data,
  run,
  isAdmin,
}: {
  data: WorkspaceData
  run: Runner
  isAdmin: boolean
}) {
  const { ret, disposition, execution } = data
  const [failOpen, setFailOpen] = useState(false)
  const [failReason, setFailReason] = useState('')
  const [confirmDisposal, setConfirmDisposal] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!disposition?.finalDisposition) return null
  const final = disposition.finalDisposition

  return (
    <Panel title="Execution" sub={`Carrying out ${dispositionLabel[final].toLowerCase()}.`}>
      {!execution || execution.status === 'PENDING' ? (
        <Button
          size="sm"
          variant="primary"
          onClick={() => void run(() => startExecution(ret.id), 'Execution started.')}
        >
          Start execution
        </Button>
      ) : (
        <p style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <ExecutionBadge status={execution.status} />
          {execution.completedAt && <span className="meta data">finished {dateTime(execution.completedAt)}</span>}
          {execution.failureReason && <span className="meta">Reason: {execution.failureReason}</span>}
        </p>
      )}
      {execution?.status === 'IN_PROGRESS' && (
        <>
          {final === 'RESTOCK' && <RestockPanel data={data} run={run} />}
          {final === 'RETURN_TO_VENDOR' && <VendorPanel data={data} run={run} />}
          {(final === 'RESELL' || final === 'LIQUIDATE') && (
            <RecoveryPanel data={data} run={run} isAdmin={isAdmin} />
          )}
          {final === 'REFURBISH' && <RefurbishPanel data={data} run={run} />}
          {(final === 'RECYCLE' || final === 'SCRAP') && (
            <DisposalPanel
              data={data}
              run={run}
              confirmOpen={confirmDisposal}
              setConfirmOpen={setConfirmDisposal}
              busy={busy}
              setBusy={setBusy}
            />
          )}
          <div style={{ marginTop: 'var(--sp-4)', display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void run(() => completeExecution(ret.id), 'Execution completed.')}
            >
              Complete execution
            </Button>
            <Button size="sm" onClick={() => setFailOpen((v) => !v)}>
              Fail…
            </Button>
          </div>
          {failOpen && (
            <form
              style={{ marginTop: 'var(--sp-3)', display: 'flex', gap: 'var(--sp-2)' }}
              onSubmit={(e) => {
                e.preventDefault()
                if (failReason.trim().length < 3) return
                setBusy(true)
                void (async () => {
                  try {
                    await run(() => failExecution(ret.id, failReason.trim()), 'Execution marked failed.')
                    setFailOpen(false)
                    setFailReason('')
                  } finally {
                    setBusy(false)
                  }
                })()
              }}
            >
              <TextInput
                aria-label="Failure reason"
                placeholder="What went wrong? (min 3 characters)"
                value={failReason}
                onChange={(e) => setFailReason(e.target.value)}
              />
              <Button variant="danger" size="sm" type="submit" disabled={failReason.trim().length < 3 || busy}>
                Confirm
              </Button>
            </form>
          )}
        </>
      )}
    </Panel>
  )
}

function RestockPanel({ data, run }: { data: WorkspaceData; run: Runner }) {
  const { ret, history } = data
  const [destination, setDestination] = useState('')
  const [busy, setBusy] = useState(false)
  if (history.restock) {
    return (
      <p className="meta" style={{ marginTop: 'var(--sp-3)' }}>
        Restocked {history.restock.recoveredQuantity} of {history.restock.quantity} to {history.restock.destination}
      </p>
    )
  }
  return (
    <form
      style={{ marginTop: 'var(--sp-3)' }}
      onSubmit={(e) => {
        e.preventDefault()
        if (!destination.trim()) return
        setBusy(true)
        void (async () => {
          try {
            await run(() => recordRestock(ret.id, { destination: destination.trim() }), 'Stock recovered.')
            setDestination('')
          } finally {
            setBusy(false)
          }
        })()
      }}
    >
      <Field label="Destination" htmlFor="restock-dest" hint="Which shelf or warehouse takes the goods back?">
        <TextInput
          id="restock-dest"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="e.g. Ahmedabad Warehouse, aisle B"
        />
      </Field>
      <Button variant="primary" size="sm" type="submit" disabled={!destination.trim() || busy}>
        {busy ? <InlineSpinner label="Recording…" /> : 'Record restocking'}
      </Button>
    </form>
  )
}

function VendorPanel({ data, run }: { data: WorkspaceData; run: Runner }) {
  const { ret, vendor: claim } = data
  const [ref, setRef] = useState('')
  const [credit, setCredit] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await run(fn, ok)
    } finally {
      setBusy(false)
    }
  }

  if (!claim) {
    return (
      <form
        style={{ marginTop: 'var(--sp-3)' }}
        onSubmit={(e) => {
          e.preventDefault()
          void act(
            () =>
              openVendorClaim(ret.id, {
                vendorReference: ref.trim() || undefined,
                expectedCredit: credit ? Number(credit) : undefined,
              }),
            'Vendor claim opened.',
          )
        }}
      >
        <div className={ui.grid2}>
          <Field label="Vendor reference (optional)" htmlFor="vc-ref">
            <TextInput id="vc-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. VND-1001" />
          </Field>
          <Field label="Expected credit (optional)" htmlFor="vc-credit">
            <TextInput
              id="vc-credit"
              type="number"
              min={0}
              step="0.01"
              value={credit}
              onChange={(e) => setCredit(e.target.value)}
            />
          </Field>
        </div>
        <Button variant="primary" size="sm" type="submit" disabled={busy}>
          {busy ? <InlineSpinner label="Opening…" /> : 'Open vendor claim'}
        </Button>
      </form>
    )
  }

  return (
    <div style={{ marginTop: 'var(--sp-3)' }}>
      <p style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <VendorBadge status={claim.status} />
        {claim.vendorReference && <span className="data meta">{claim.vendorReference}</span>}
        {claim.expectedCredit !== null && <span className="meta">expected {money(claim.expectedCredit)}</span>}
        {claim.actualCredit !== null && <span className="meta">actual {money(claim.actualCredit)}</span>}
      </p>
      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-2)' }}>
        {claim.status === 'DRAFT' && (
          <Button size="sm" onClick={() => void act(() => submitVendorClaim(ret.id), 'Claim submitted.')} disabled={busy}>
            Submit claim
          </Button>
        )}
        {claim.status === 'SUBMITTED' && (
          <>
            <Button
              size="sm"
              onClick={() => void act(() => acknowledgeVendorClaim(ret.id), 'Claim acknowledged.')}
              disabled={busy}
            >
              Acknowledge
            </Button>
            <Button
              size="sm"
              onClick={() => void act(() => rejectVendorClaim(ret.id, reason.trim() || 'Rejected by vendor'), 'Claim rejected.')}
              disabled={busy}
            >
              Reject
            </Button>
          </>
        )}
        {claim.status === 'ACKNOWLEDGED' && (
          <>
            <Button
              size="sm"
              onClick={() => void act(() => approveVendorClaim(ret.id), 'Claim approved.')}
              disabled={busy}
            >
              Approve
            </Button>
            <Button
              size="sm"
              onClick={() => void act(() => rejectVendorClaim(ret.id, reason.trim() || 'Rejected by vendor'), 'Claim rejected.')}
              disabled={busy}
            >
              Reject
            </Button>
          </>
        )}
        {claim.status === 'APPROVED' && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => void act(() => settleVendorClaim(ret.id, credit ? Number(credit) : undefined), 'Claim settled.')}
            disabled={busy}
          >
            Settle claim
          </Button>
        )}
      </div>
      {(claim.status === 'SUBMITTED' || claim.status === 'ACKNOWLEDGED' || claim.status === 'APPROVED') && (
        <div className={ui.grid2} style={{ marginTop: 'var(--sp-3)' }}>
          <Field label="Actual credit (settle)" htmlFor="vc-actual">
            <TextInput
              id="vc-actual"
              type="number"
              min={0}
              step="0.01"
              value={credit}
              onChange={(e) => setCredit(e.target.value)}
            />
          </Field>
          <Field label="Rejection note (reject)" htmlFor="vc-reason">
            <TextInput
              id="vc-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why was it refused?"
            />
          </Field>
        </div>
      )}
    </div>
  )
}

function RecoveryPanel({ data, run, isAdmin }: { data: WorkspaceData; run: Runner; isAdmin: boolean }) {
  const { ret, recovery: record } = data
  const [channel, setChannel] = useState('open-box-store')
  const [actual, setActual] = useState('')
  const [fees, setFees] = useState('')
  const [correctActual, setCorrectActual] = useState('')
  const [correctReason, setCorrectReason] = useState('')
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await run(fn, ok)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 'var(--sp-3)' }}>
      {record && (
        <p style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <RecoveryBadge status={record.status} />
          <span className="meta">
            {record.channel} · expected {money(record.expectedRecovery)}
            {record.actualRecovered !== null && <> · actual {money(record.actualRecovered)}</>} · net{' '}
            {money(record.netRecovered)}
          </span>
        </p>
      )}
      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-2)' }}>
        {!record && (
          <Button
            size="sm"
            onClick={() => void act(() => openRecovery(ret.id, { channel }), 'Recovery opened.')}
            disabled={busy}
          >
            Open recovery
          </Button>
        )}
        {record?.status === 'PENDING' && (
          <Button size="sm" onClick={() => void act(() => listRecovery(ret.id), 'Listed for sale.')} disabled={busy}>
            List for sale
          </Button>
        )}
        {record?.status === 'LISTED' && (
          <Button
            size="sm"
            variant="primary"
            disabled={!actual || busy}
            onClick={() =>
              void act(
                () => sellRecovery(ret.id, Number(actual), fees ? Number(fees) : undefined),
                'Sale recorded.',
              )
            }
          >
            Record sale
          </Button>
        )}
        {record?.status === 'SOLD' && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => void act(() => settleRecovery(ret.id), 'Recovery settled.')}
            disabled={busy}
          >
            Settle
          </Button>
        )}
      </div>
      {!record && (
        <div style={{ marginTop: 'var(--sp-3)', maxWidth: 320 }}>
          <Field label="Channel" htmlFor="rec-channel">
            <TextInput id="rec-channel" value={channel} onChange={(e) => setChannel(e.target.value)} />
          </Field>
        </div>
      )}
      {record?.status === 'LISTED' && (
        <div className={ui.grid2} style={{ marginTop: 'var(--sp-3)' }}>
          <Field label="Actual recovered" htmlFor="rec-actual">
            <TextInput
              id="rec-actual"
              type="number"
              min={0}
              step="0.01"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
            />
          </Field>
          <Field label="Fees (optional)" htmlFor="rec-fees">
            <TextInput
              id="rec-fees"
              type="number"
              min={0}
              step="0.01"
              value={fees}
              onChange={(e) => setFees(e.target.value)}
            />
          </Field>
        </div>
      )}
      {isAdmin && record && (record.status === 'SOLD' || record.status === 'SETTLED') && (
        <form
          style={{ marginTop: 'var(--sp-4)', borderTop: '1px dashed var(--line)', paddingTop: 'var(--sp-3)' }}
          onSubmit={(e) => {
            e.preventDefault()
            if (!correctActual || correctReason.trim().length < 3) return
            void act(
              () => correctRecovery(ret.id, Number(correctActual), undefined, correctReason.trim()),
              'Figures corrected.',
            )
          }}
        >
          <p className="eyebrow">Admin correction</p>
          <div className={ui.grid2}>
            <Field label="Corrected actual" htmlFor="rec-correct">
              <TextInput
                id="rec-correct"
                type="number"
                min={0}
                step="0.01"
                value={correctActual}
                onChange={(e) => setCorrectActual(e.target.value)}
              />
            </Field>
            <Field label="Reason (required)" htmlFor="rec-correct-reason">
              <TextInput
                id="rec-correct-reason"
                value={correctReason}
                onChange={(e) => setCorrectReason(e.target.value)}
                placeholder="Why are the figures changing?"
              />
            </Field>
          </div>
          <Button size="sm" type="submit" disabled={!correctActual || correctReason.trim().length < 3 || busy}>
            Correct figures
          </Button>
        </form>
      )}
    </div>
  )
}

function RefurbishPanel({ data, run }: { data: WorkspaceData; run: Runner }) {
  const { ret, execution, tasks } = data
  const mine = tasks.filter((t) => t.executionId === execution?.id && t.type === 'REFURBISH_ITEM')
  const done = mine.some((t) => t.status === 'COMPLETED')
  const open = mine.find((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS')

  if (done) {
    return (
      <p className="meta" style={{ marginTop: 'var(--sp-3)' }}>
        Refurbishment task completed — execution can be finished.
      </p>
    )
  }
  if (open) {
    return (
      <div style={{ marginTop: 'var(--sp-3)', display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
        <TaskBadge status={open.status} />
        {open.status === 'OPEN' && (
          <Button size="sm" onClick={() => void run(() => startTask(open.id), 'Refurbishment started.')}>
            Start refurbishment
          </Button>
        )}
        {open.status === 'IN_PROGRESS' && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => void run(() => completeTask(open.id), 'Refurbishment recorded.')}
          >
            Mark refurbishment done
          </Button>
        )}
      </div>
    )
  }
  return (
    <div style={{ marginTop: 'var(--sp-3)' }}>
      <Button
        size="sm"
        variant="primary"
        onClick={() =>
          void run(
            () =>
              createTask({
                returnId: ret.id,
                type: 'REFURBISH_ITEM',
                executionId: execution?.id ?? undefined,
                notes: 'Refurbishment from workspace',
              }).then((t) => startTask(t.id)),
            'Refurbishment task started.',
          )
        }
      >
        Record refurbishment task
      </Button>
    </div>
  )
}

function DisposalPanel({
  data,
  run,
  confirmOpen,
  setConfirmOpen,
  busy,
  setBusy,
}: {
  data: WorkspaceData
  run: Runner
  confirmOpen: boolean
  setConfirmOpen: (v: boolean) => void
  busy: boolean
  setBusy: (v: boolean) => void
}) {
  const { ret, history } = data
  const [partner, setPartner] = useState('')
  const [actual, setActual] = useState('')

  if (history.disposal) {
    return (
      <p className="meta" style={{ marginTop: 'var(--sp-3)' }}>
        {dispositionLabel[history.disposal.disposition]} completed for {history.disposal.quantity} unit(s)
        {history.disposal.actualRecovery !== null && <> · recovered {money(history.disposal.actualRecovery)}</>}
      </p>
    )
  }
  const channel = data.disposition?.finalDisposition === 'RECYCLE' ? 'recycling' : 'scrapping'
  return (
    <>
      <div className={ui.grid2} style={{ marginTop: 'var(--sp-3)' }}>
        <Field label="Partner / location (optional)" htmlFor="dis-partner">
          <TextInput
            id="dis-partner"
            value={partner}
            onChange={(e) => setPartner(e.target.value)}
            placeholder="e.g. GreenRecycle"
          />
        </Field>
        <Field label="Actual recovery (optional)" htmlFor="dis-actual">
          <TextInput
            id="dis-actual"
            type="number"
            min={0}
            step="0.01"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
          />
        </Field>
      </div>
      <Button size="sm" variant="danger" onClick={() => setConfirmOpen(true)}>
        Complete {channel}…
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title={`Complete ${channel}?`}
        body="This is terminal: the goods leave inventory for good. This cannot be undone."
        confirmLabel="Complete disposal"
        danger
        busy={busy}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setBusy(true)
          void (async () => {
            try {
              await run(
                () =>
                  completeDisposal(ret.id, {
                    partner: partner.trim() || undefined,
                    actualRecovery: actual ? Number(actual) : undefined,
                  }),
                'Disposal recorded.',
              )
              setConfirmOpen(false)
            } finally {
              setBusy(false)
            }
          })()
        }}
      />
    </>
  )
}

/* ---------- tasks ---------- */

function TasksSection({ returnId, tasks, run }: { returnId: string; tasks: OpsTask[]; run: Runner }) {
  const [type, setType] = useState('RESTOCK_ITEM')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <Panel title="Operational tasks" sub={`${tasks.length} task${tasks.length === 1 ? '' : 's'} on this return.`}>
      <form
        style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 'var(--sp-3)' }}
        onSubmit={(e) => {
          e.preventDefault()
          setBusy(true)
          void (async () => {
            try {
              await run(
                () => createTask({ returnId, type: type as OpsTask['type'], notes: notes.trim() || undefined }),
                'Task created.',
              )
              setNotes('')
            } finally {
              setBusy(false)
            }
          })()
        }}
      >
        <Field label="New task" htmlFor="task-type">
          <SelectInput id="task-type" value={type} onChange={(e) => setType(e.target.value)}>
            {['INSPECT_RETURN', 'RESTOCK_ITEM', 'REFURBISH_ITEM', 'SUBMIT_VENDOR_CLAIM', 'SEND_TO_LIQUIDATION', 'PROCESS_RECYCLING', 'SCRAP_ITEM'].map(
              (t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ').toLowerCase()}
                </option>
              ),
            )}
          </SelectInput>
        </Field>
        <Field label="Note (optional)" htmlFor="task-notes">
          <TextInput id="task-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What exactly?" />
        </Field>
        <Button size="sm" type="submit" disabled={busy}>
          Add task
        </Button>
      </form>
      {tasks.length === 0 ? (
        <p className="meta">No tasks yet. Create the first piece of work above.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} run={run} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

function TaskRow({ task, run }: { task: OpsTask; run: Runner }) {
  return (
    <li
      style={{
        display: 'flex',
        gap: 'var(--sp-2)',
        alignItems: 'center',
        padding: 'var(--sp-2) 0',
        borderTop: '1px solid var(--line)',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ flex: 1, minWidth: 160 }}>
        {task.type.replace(/_/g, ' ').toLowerCase()}
        {task.notes && <span className="meta"> — {task.notes}</span>}
      </span>
      <TaskBadge status={task.status} />
      {task.status === 'OPEN' && (
        <Button size="sm" onClick={() => void run(() => startTask(task.id), 'Task started.')}>
          Start
        </Button>
      )}
      {task.status === 'IN_PROGRESS' && (
        <Button size="sm" variant="primary" onClick={() => void run(() => completeTask(task.id), 'Task completed.')}>
          Complete
        </Button>
      )}
    </li>
  )
}

/* ---------- history ---------- */

function HistoryPanel({ data }: { data: WorkspaceData }) {
  const { history } = data
  if (history.events.length === 0) {
    return (
      <Panel title="History">
        <p className="meta">No events recorded yet.</p>
      </Panel>
    )
  }
  return (
    <Panel title="History" sub={`${history.events.length} events, oldest first.`}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {history.events.map((e, i) => (
          <li
            key={`${e.action}-${e.timestamp}-${i}`}
            style={{ padding: 'var(--sp-2) 0', borderTop: i === 0 ? 0 : '1px solid var(--line)', fontSize: 'var(--fs-body)' }}
          >
            <strong>{e.action.replace(/_/g, ' ').toLowerCase()}</strong>{' '}
            <span className="meta data">{dateTime(e.timestamp)}</span>
            {e.actor && <span className="meta"> · {e.actor}</span>}
            {e.reason && <div className="meta">{e.reason}</div>}
          </li>
        ))}
      </ol>
    </Panel>
  )
}
