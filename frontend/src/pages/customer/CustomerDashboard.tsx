import { Link } from 'react-router-dom'
import { ArrowRight, Plus } from 'lucide-react'
import { useAuth } from '../../auth/AuthContext'
import { useAsync } from '../../hooks/useAsync'
import { dateOnly } from '../../lib/format'
import { listReturns } from '../../services/returns'
import type { ReturnOrder } from '../../lib/types'
import { EmptyState, LinkButton, LoadError, Metric, PageHead, Panel, Skeleton } from '../../components/ui'
import ui from '../../components/ui.module.css'
import { ReturnBadge } from '../../components/status'

const ACTIVE: ReturnOrder['status'][] = [
  'REQUESTED',
  'APPROVED',
  'IN_TRANSIT',
  'RECEIVED',
  'INSPECTION_PENDING',
  'INSPECTION_IN_PROGRESS',
]

function nextAction(r: ReturnOrder): string | null {
  switch (r.status) {
    case 'REQUESTED':
      return 'Waiting for warehouse approval'
    case 'APPROVED':
      return 'Ship your item to start its journey back'
    case 'IN_TRANSIT':
      return 'On its way to the warehouse'
    case 'RECEIVED':
    case 'INSPECTION_PENDING':
    case 'INSPECTION_IN_PROGRESS':
      return 'Being inspected'
    case 'INSPECTION_COMPLETED':
      return 'Inspection done — outcome being decided'
    default:
      return null
  }
}

export default function CustomerDashboard() {
  const { user } = useAuth()
  const { data, error, loading, reload } = useAsync((_signal) =>
    listReturns({ page: 0, size: 20 }).then((p) => p),
  )

  return (
    <>
      <PageHead
        title={`Good day, ${user?.fullName.split(' ')[0] ?? 'there'}`}
        intro="Your returns at a glance. Anything needing you is listed first."
        actions={
          <LinkButton to="/returns/new" variant="primary">
            <Plus size={15} aria-hidden="true" /> Start a return
          </LinkButton>
        }
      />
      {loading && (
        <div>
          <Skeleton height={90} />
          <div style={{ height: 'var(--sp-4)' }} />
          <Skeleton height={180} />
        </div>
      )}
      {error && <LoadError error={error} onRetry={reload} />}
      {data && (
        <>
          {data.content.length === 0 ? (
            <EmptyState
              title="No returns yet"
              body="Your return history will appear here once you create your first return. Delivered orders become eligible automatically."
              action={
                <LinkButton to="/returns/new" variant="primary">
                  Start a return
                </LinkButton>
              }
            />
          ) : (
            <AttentionPanel returns={data.content} />
          )}
          {data.content.length > 0 && (
            <Panel title="Recent returns" sub="Newest first. Open one for the full journey.">
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {data.content.slice(0, 6).map((r) => (
                  <li
                    key={r.id}
                    style={{
                      display: 'flex',
                      gap: 'var(--sp-3)',
                      alignItems: 'center',
                      padding: 'var(--sp-3) 0',
                      borderTop: '1px solid var(--line)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Link to={`/returns/${r.id}`} className="rowLink data">
                        {r.returnNumber}
                      </Link>
                      <div className="meta">
                        {r.items.length} item{r.items.length === 1 ? '' : 's'} · requested {dateOnly(r.requestedAt)}
                        {nextAction(r) && <> · {nextAction(r)}</>}
                      </div>
                    </div>
                    <ReturnBadge status={r.status} />
                    <span className="meta" aria-hidden="true">
                      <ArrowRight size={15} />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="meta" style={{ marginTop: 'var(--sp-3)' }}>
                Showing {Math.min(6, data.content.length)} of {data.totalElements} ·{' '}
                <Link to="/returns">View all returns</Link>
              </p>
            </Panel>
          )}
          <div className={ui.grid3} style={{ marginTop: 'var(--sp-4)' }}>
            <Panel>
              <Metric value={String(data.content.filter((r) => ACTIVE.includes(r.status)).length)} label="Active returns" />
            </Panel>
            <Panel>
              <Metric value={String(data.totalElements)} label="Total returns" />
            </Panel>
            <Panel>
              <Metric
                value={String(data.content.filter((r) => r.status === 'INSPECTION_COMPLETED').length)}
                label="Awaiting outcome"
              />
            </Panel>
          </div>
        </>
      )}
    </>
  )
}

function AttentionPanel({ returns }: { returns: ReturnOrder[] }) {
  const actionable = returns.filter((r) => r.status === 'APPROVED' || r.status === 'REJECTED')
  const active = returns.filter((r) => ACTIVE.includes(r.status))
  return (
    <Panel title="Needs your attention">
      <div className={ui.attentionBody} data-testid="attention-body">
        {actionable.length === 0 ? (
          <p className="meta" style={{ margin: 0 }}>
            {active.length === 0
              ? 'Nothing needs you right now. Your returns are moving on their own.'
              : `Nothing needs you right now. ${active.length} return${active.length === 1 ? ' is' : 's are'} with the warehouse — follow along below.`}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {actionable.map((r) => (
              <li
                key={r.id}
                style={{
                  display: 'flex',
                  gap: 'var(--sp-3)',
                  alignItems: 'center',
                  padding: 'var(--sp-3) 0',
                  borderTop: '1px solid var(--line)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link to={`/returns/${r.id}`} className="rowLink data">
                    {r.returnNumber}
                  </Link>
                  <div className="meta">
                    {r.status === 'APPROVED'
                      ? 'Approved — ship your item so the warehouse can receive it.'
                      : `Not approved — ${r.rejectionReason ?? 'see details for the reason.'}`}
                  </div>
                </div>
                <ReturnBadge status={r.status} />
                <span className="meta" aria-hidden="true">
                  <ArrowRight size={15} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}
