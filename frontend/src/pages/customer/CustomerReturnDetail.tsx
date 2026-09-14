import { Link, useParams } from 'react-router-dom'
import { useAsync } from '../../hooks/useAsync'
import { dateTime, returnReasonLabel } from '../../lib/format'
import { getDisposition, getInspection, getReturn } from '../../services/returns'
import { getHistory } from '../../services/operations'
import { ApiRequestError } from '../../lib/api'
import { ErrorState, LoadError, PageHead, Panel, Skeleton } from '../../components/ui'
import ui from '../../components/ui.module.css'
import { DispositionMark, InspectionSummaryLine, ReturnBadge } from '../../components/status'
import { Timeline, type TimelineStep } from '../../components/visuals'

function buildTimeline(
  r: Awaited<ReturnType<typeof getReturn>>,
  history: Awaited<ReturnType<typeof getHistory>> | null,
): TimelineStep[] {
  const terminal = r.status === 'REJECTED'
  const order: TimelineStep[] = [
    { key: 'requested', title: 'Requested', detail: dateTime(r.requestedAt), state: 'done' },
  ]
  if (terminal) {
    order.push({
      key: 'rejected',
      title: 'Rejected',
      detail: r.rejectionReason ?? dateTime(r.rejectedAt),
      state: 'now',
    })
    return order
  }
  const approved = r.approvedAt !== null
  order.push({
    key: 'approved',
    title: 'Approved',
    detail: approved ? dateTime(r.approvedAt) : 'Waiting for warehouse approval',
    state: approved ? 'done' : 'now',
  })
  if (!approved) return [...order, { key: 'rest', title: 'Ship → inspect → outcome', state: 'todo' }]
  const received = r.receivedAt !== null
  order.push({
    key: 'received',
    title: 'Received at warehouse',
    detail: received ? dateTime(r.receivedAt) : 'Ship your item to continue',
    state: received ? 'done' : 'now',
  })
  if (!received) return [...order, { key: 'rest', title: 'Inspect → outcome', state: 'todo' }]
  const inspectedAt = history?.inspection ? dateTime(history.inspection.inspectedAt) : null
  const inspected = inspectedAt !== null
  order.push({
    key: 'inspection',
    title: 'Inspection',
    detail: inspected ? inspectedAt : 'Queued for inspection',
    state: inspected ? 'done' : 'now',
  })
  if (!inspected) return [...order, { key: 'rest', title: 'Outcome', state: 'todo' }]
  const outcome = history?.disposition?.finalDisposition ?? history?.disposition?.recommended ?? null
  order.push({
    key: 'outcome',
    title: outcome ? `Outcome: ${outcome.replace(/_/g, ' ').toLowerCase()}` : 'Outcome being decided',
    detail: history?.disposition?.finalizedAt ? dateTime(history.disposition.finalizedAt) : undefined,
    state: outcome ? 'done' : 'now',
  })
  const completed = history?.execution?.status === 'COMPLETED'
  order.push({
    key: 'completed',
    title: 'Completed',
    detail: completed && history?.execution?.completedAt ? dateTime(history.execution.completedAt) : undefined,
    state: completed ? 'done' : 'todo',
  })
  return order
}

export default function CustomerReturnDetail() {
  const { id = '' } = useParams()
  const ret = useAsync((_signal) => getReturn(id), [id])
  const history = useAsync((_signal) => getHistory(id), [id])
  const inspection = useAsync(
    async () => {
      try {
        return await getInspection(id)
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 404) return null
        throw e
      }
    },
    [id],
  )
  const disposition = useAsync(
    async () => {
      try {
        return await getDisposition(id)
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 404) return null
        throw e
      }
    },
    [id],
  )

  if (ret.loading) {
    return (
      <>
        <Skeleton width={200} height={26} />
        <div style={{ height: 'var(--sp-4)' }} />
        <Skeleton height={220} />
      </>
    )
  }
  if (ret.error) return <LoadError error={ret.error} onRetry={ret.reload} />
  if (!ret.data) return <ErrorState kind="not-found" title="Return not found" body="It may have been removed." />

  const r = ret.data
  return (
    <>
      <PageHead
        title={r.returnNumber}
        intro={`Requested ${dateTime(r.requestedAt)} · ${r.items.length} item${r.items.length === 1 ? '' : 's'}`}
        actions={<ReturnBadge status={r.status} />}
      />
      <div className={ui.grid2}>
        <Panel title="Journey">
          <Timeline steps={buildTimeline(r, history.data)} />
        </Panel>
        <div>
          <Panel title="Items">
            <dl style={{ margin: 0 }}>
              {r.items.map((i) => (
                <div className={ui.kv} key={i.id}>
                  <dt>
                    {i.quantity} × {i.sku}
                  </dt>
                  <dd>{returnReasonLabel[i.reason]}</dd>
                </div>
              ))}
            </dl>
            {r.rejectionReason && (
              <p className="meta" style={{ marginTop: 'var(--sp-3)' }}>
                Rejection note: {r.rejectionReason}
              </p>
            )}
          </Panel>
          <Panel title="Inspection">
            {inspection.loading && <Skeleton height={40} />}
            {inspection.error && <p className="meta">Couldn't load the inspection. Try again later.</p>}
            {!inspection.loading && !inspection.error && !inspection.data && (
              <p className="meta">Not inspected yet — this appears once the warehouse finishes.</p>
            )}
            {inspection.data && (
              <p>
                <InspectionSummaryLine
                  physical={inspection.data.physicalCondition}
                  packaging={inspection.data.packagingCondition}
                  functional={inspection.data.functionalTestResult}
                />
              </p>
            )}
          </Panel>
          {disposition.data?.finalDisposition && (
            <Panel title="Outcome">
              <DispositionMark value={disposition.data.finalDisposition} />
              {disposition.data.overridden && <p className="meta">Adjusted by the warehouse team.</p>}
            </Panel>
          )}
        </div>
      </div>
      <p style={{ marginTop: 'var(--sp-4)' }}>
        <Link to="/returns">← Back to my returns</Link>
      </p>
    </>
  )
}
