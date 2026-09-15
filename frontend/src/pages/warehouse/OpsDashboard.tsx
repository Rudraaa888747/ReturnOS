import { Link } from 'react-router-dom'
import { useAsync } from '../../hooks/useAsync'
import { dateOnly } from '../../lib/format'
import { listReturns } from '../../services/returns'
import { listTasks } from '../../services/operations'
import { listAudit } from '../../services/admin'
import { EmptyState, LinkButton, LoadError, Metric, PageHead, Panel, Skeleton } from '../../components/ui'
import ui from '../../components/ui.module.css'
import { ReturnBadge, TaskBadge } from '../../components/status'
import type { ReturnOrder } from '../../lib/types'

function useOpsData() {
  return useAsync(async () => {
    const [requested, received, queued, tasks] = await Promise.all([
      listReturns({ status: 'REQUESTED', page: 0, size: 5 }),
      listReturns({ status: 'RECEIVED', page: 0, size: 5 }),
      listReturns({ status: 'INSPECTION_PENDING', page: 0, size: 5 }),
      listTasks({ mine: true, status: 'OPEN', page: 0, size: 5 }),
    ])
    return { requested, received, queued, tasks }
  })
}

export default function OpsDashboard() {
  const { data, error, loading, reload } = useOpsData()
  const events = useAsync(() => listAudit({ page: 0, size: 7 }))

  return (
    <>
      <PageHead
        title="Operations"
        intro="Everything waiting on the warehouse floor, in priority order."
        actions={
          <LinkButton to="/ops/returns" variant="primary">
            Open work queue
          </LinkButton>
        }
      />
      {loading && (
        <>
          <Skeleton height={90} />
          <div style={{ height: 'var(--sp-4)' }} />
          <Skeleton height={180} />
        </>
      )}
      {error && <LoadError error={error} onRetry={reload} />}
      {data && (
        <>
          <AttentionPanel requested={data.requested.content} received={data.received.content} />
          <div className={ui.grid3} style={{ marginBottom: 'var(--sp-4)', marginTop: 'var(--sp-4)' }}>
            <Panel>
              <Metric value={String(data.requested.totalElements)} label="Awaiting approval" />
              <p className="meta">
                <Link to="/ops/returns?status=REQUESTED">Review requests →</Link>
              </p>
            </Panel>
            <Panel>
              <Metric value={String(data.received.totalElements)} label="Received, not inspected" />
              <p className="meta">
                <Link to="/ops/returns?status=RECEIVED">Start inspecting →</Link>
              </p>
            </Panel>
            <Panel>
              <Metric value={String(data.tasks.totalElements)} label="My open tasks" />
              <p className="meta">
                <Link to="/ops/tasks">View my tasks →</Link>
              </p>
            </Panel>
          </div>
          <div className={ui.grid2}>
            <Panel title="My open tasks" sub="Assigned to you, oldest first.">
              {data.tasks.content.length === 0 ? (
                <EmptyState title="No open tasks" body="Nothing assigned to you right now." />
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {data.tasks.content.map((t) => (
                    <li
                      key={t.id}
                      style={{
                        display: 'flex',
                        gap: 'var(--sp-3)',
                        alignItems: 'center',
                        padding: 'var(--sp-2) 0',
                        borderTop: '1px solid var(--line)',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <Link to={`/ops/returns/${t.returnId}`} className={ui.rowLink}>
                          {t.type.replace(/_/g, ' ').toLowerCase()}
                        </Link>
                        <div className="meta data">{dateOnly(t.createdAt)}</div>
                      </div>
                      <TaskBadge status={t.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
          {events.data && events.data.content.length > 0 && (
            <Panel title="Latest floor activity">
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {events.data.content.map((e) => (
                  <li key={e.id} className="meta" style={{ padding: 'var(--sp-1) 0', borderTop: '1px solid var(--line)' }}>
                    <span className="data">{dateOnly(e.createdAt)}</span> · {e.action.replace(/_/g, ' ').toLowerCase()}
                    {e.performedBy ? ` · ${e.performedBy}` : ''} — {e.reason ?? '—'}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </>
  )
}

function AttentionPanel({ requested, received }: { requested: ReturnOrder[]; received: ReturnOrder[] }) {
  const urgent = [...requested, ...received]
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
    .slice(0, 6)
  return (
    <Panel title="Needs attention now" sub="Oldest approvals and uninspected receipts first.">
      {urgent.length === 0 ? (
        <p className="meta" style={{ margin: 0 }}>
          Floor is clear — no returns waiting for approval or inspection. New work appears here first.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {urgent.map((r) => (
            <li
              key={r.id}
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                alignItems: 'center',
                padding: 'var(--sp-2) 0',
                borderTop: '1px solid var(--line)',
              }}
            >
              <div style={{ flex: 1 }}>
                <Link to={`/ops/returns/${r.id}`} className={`${ui.rowLink} data`}>
                  {r.returnNumber}
                </Link>
                <div className="meta">
                  {r.status === 'REQUESTED'
                    ? `Waiting for approval · requested ${dateOnly(r.requestedAt)}`
                    : `Received, not inspected · waiting since ${dateOnly(r.receivedAt ?? r.requestedAt)}`}
                </div>
              </div>
              <ReturnBadge status={r.status} />
              {r.status === 'REQUESTED' ? (
                <Link to={`/ops/returns/${r.id}`} className={`${ui.btn} ${ui.btnPrimary} ${ui.btnSm}`}>
                  Review
                </Link>
              ) : (
                <Link to={`/ops/returns/${r.id}`} className={`${ui.btn} ${ui.btnSecondary} ${ui.btnSm}`}>
                  Open
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
