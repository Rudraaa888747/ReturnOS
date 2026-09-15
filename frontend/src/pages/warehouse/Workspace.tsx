import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { errorMessage } from '../../lib/api';
import { dateTime, dispositionLabel, returnReasonLabel } from '../../lib/format';
import {
  approveReturn,
  assessRisk,
  evaluateDisposition,
  receiveReturn,
  rejectReturn,
} from '../../services/returns';
import { startExecution } from '../../services/operations';
import type { ReturnOrder } from '../../lib/types';
import {
  Button,
  LoadError,
  PageHead,
  Panel,
  Skeleton,
  TextInput,
} from '../../components/ui';
import ui from '../../components/ui.module.css';
import { useToast } from '../../components/feedback';
import { ReturnBadge } from '../../components/status';
import { DispositionSection } from './workspace/DispositionSection';
import { ExecutionSection } from './workspace/ExecutionSection';
import { HistoryPanel } from './workspace/HistoryPanel';
import { InspectionSection } from './workspace/InspectionSection';
import { RiskSection } from './workspace/RiskSection';
import { TasksSection } from './workspace/TasksSection';
import { loadWorkspace, type Runner, type WorkspaceData } from './workspace/types';

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
  // Stage-aware disclosure: only the section matching the return's current
  // stage starts expanded; everything stays one click away.
  const inspectable = ['RECEIVED', 'INSPECTION_PENDING', 'INSPECTION_IN_PROGRESS'].includes(ret.status)
  const focus =
    !data.inspection && inspectable
      ? 'inspection'
      : data.inspection && !data.risk
        ? 'risk'
        : data.inspection && !data.disposition?.finalDisposition
          ? 'disposition'
          : data.disposition?.finalDisposition &&
              (!data.execution || data.execution.status !== 'COMPLETED')
            ? 'execution'
            : ''
  return (
    <>
      <PageHead
        title={ret.returnNumber}
        intro={`Requested ${dateTime(ret.requestedAt)} · ${ret.items.length} item${ret.items.length === 1 ? '' : 's'}`}
        actions={<ReturnBadge status={ret.status} />}
      />
      <NextActionBar data={data} run={run} />
      <StatusPanel ret={ret} run={run} />
      <InspectionSection data={data} run={run} open={focus === 'inspection'} />
      <RiskSection data={data} run={run} open={focus === 'risk'} />
      <DispositionSection data={data} run={run} isAdmin={isAdmin} open={focus === 'disposition'} />
      <ExecutionSection data={data} run={run} isAdmin={isAdmin} open={focus === 'execution'} />
      <TasksSection returnId={id} tasks={data.tasks} run={run} />
      <HistoryPanel data={data} />
      <p style={{ marginTop: 'var(--sp-4)' }}>
        <Link to="/ops/returns">← Back to work queue</Link>
      </p>
    </>
  )
}


function stageOf(data: WorkspaceData): string {
  const { ret, inspection, risk, disposition, execution } = data
  if (ret.status === 'REJECTED') return 'Closed'
  if (ret.status === 'REQUESTED') return 'Awaiting decision'
  if (ret.status === 'APPROVED') return 'Approved'
  if (ret.status === 'IN_TRANSIT') return 'In transit'
  if (!inspection) return 'Inspection'
  if (!risk) return 'Risk'
  if (!disposition?.finalDisposition) return 'Disposition'
  if (!execution || execution.status === 'PENDING') return 'Ready to execute'
  if (execution.status === 'IN_PROGRESS') return 'Executing'
  if (execution.status === 'FAILED') return 'Needs attention'
  return 'Complete'
}

function NextActionBar({ data, run }: { data: WorkspaceData; run: Runner }) {
  const { ret, inspection, risk, disposition, execution } = data
  const stage = stageOf(data)
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
    <div className={ui.actionBar} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--sp-1)' }}>
      <span className="eyebrow">Current step · {stage}</span>
      <span style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ marginRight: 'auto', fontWeight: 600 }}>{lead}</span>
        {action && (
          <Button variant="primary" size="sm" onClick={() => void action.run()}>
            {action.label}
          </Button>
        )}
      </span>
    </div>
  )
}


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
