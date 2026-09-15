import { useState } from 'react';
import {
  acknowledgeVendorClaim,
  approveVendorClaim,
  completeDisposal,
  completeExecution,
  completeTask,
  correctRecovery,
  createTask,
  failExecution,
  listRecovery,
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
} from '../../../services/operations';
import { dateTime, dispositionLabel, money } from '../../../lib/format';
import {
  Button,
  Disclosure,
  Field,
  InlineSpinner,
  TextInput,
} from '../../../components/ui';
import ui from '../../../components/ui.module.css';
import { ConfirmDialog } from '../../../components/feedback';
import {
  ExecutionBadge,
  RecoveryBadge,
  TaskBadge,
  VendorBadge,
} from '../../../components/status';
import type { Runner, WorkspaceData } from './types';

export function ExecutionSection({
  data,
  run,
  isAdmin,
  open,
}: {
  data: WorkspaceData
  run: Runner
  isAdmin: boolean
  open?: boolean
}) {
  const { ret, disposition, execution } = data
  const [failOpen, setFailOpen] = useState(false)
  const [failReason, setFailReason] = useState('')
  const [confirmDisposal, setConfirmDisposal] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!disposition?.finalDisposition) return null
  const final = disposition.finalDisposition

  return (
    <Disclosure title="Execution" sub={`Carrying out ${dispositionLabel[final].toLowerCase()}.`} open={open}>
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
    </Disclosure>
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


