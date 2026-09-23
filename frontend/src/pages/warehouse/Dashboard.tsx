import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { wh } from '../../lib/warehouse'
import type { WarehouseSummary } from '../../lib/warehouse'
import { warningLabel } from '../../lib/warehouse'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import styles from './dashboard.module.css'

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

/* Plain-language WARNING_* labels live in lib/warehouse (warningLabel) so
 * every floor page describes the same audit action the same way. */

/** camelCase count keys → readable labels ("inProgress" → "In Progress"). */
function humanizeTaskKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function priorityTone(priority: string): string {
  if (priority === 'URGENT') return styles.priUrgent
  if (priority === 'HIGH') return styles.priHigh
  if (priority === 'NORMAL') return styles.priNormal
  return styles.priLow
}

interface StatDef {
  label: string
  value: number
  to?: string
  alert?: boolean
}

export default function WarehouseDashboard() {
  const [summary, setSummary] = useState<WarehouseSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true)
      setError(null)
      try {
        const data = await wh<WarehouseSummary>('/summary')
        if (!cancelled) setSummary(data)
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 403) {
            setError('This account is not assigned to a warehouse.')
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
  }, [attempt])

  if (loading) {
    return (
      <div>
        <PageHead kicker="Floor" title="Dashboard" lede="Live floor state, derived from real rows." />
        <LoadingState label="Loading floor summary…" />
      </div>
    )
  }

  if (error || !summary) {
    return (
      <div>
        <PageHead kicker="Floor" title="Dashboard" lede="Live floor state, derived from real rows." />
        <ErrorState message={error ?? 'Summary could not be loaded.'} onRetry={() => setAttempt((v) => v + 1)} />
      </div>
    )
  }

  const stats: StatDef[] = [
    { label: 'Awaiting arrival', value: summary.awaitingArrival, to: '/warehouse/returns' },
    { label: 'Pending inspection', value: summary.pendingInspection, to: '/warehouse/returns?status=RECEIVED' },
    { label: 'In inspection', value: summary.inInspection, to: '/warehouse/returns?status=INSPECTION' },
    { label: 'Pending approval', value: summary.pendingApproval, to: '/warehouse/returns', alert: summary.pendingApproval > 0 },
    { label: 'Overdue returns', value: summary.overdue, to: '/warehouse/returns', alert: summary.overdue > 0 },
    { label: 'Movements today', value: summary.movementsToday },
    { label: 'Resolved', value: summary.resolved, to: '/warehouse/returns?status=RESOLVED' },
  ]

  const taskEntries = Object.entries(summary.tasks ?? {})

  /** Urgency tint for task chips: zero counts stay neutral, the rest speak. */
  function taskChipTone(key: string, count: number): string {
    if (count <= 0) return ''
    if (key === 'overdue') return styles.taskBad
    if (key === 'blocked') return styles.taskWarn
    if (key === 'completedToday') return styles.taskOk
    return ''
  }

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Floor"
        title="Dashboard"
        lede="Live floor state, derived from real rows — never hardcoded."
        actions={<Link to="/warehouse/returns">Work the queue</Link>}
      />

      <section aria-label="Floor counts">
        <ul className={styles.stats}>
          {stats.map((stat) => (
            <li
              key={stat.label}
              className={`${styles.stat} ${stat.alert ? styles.statAlert : ''} ${stat.to ? styles.statClickable : ''}`}
            >
              {stat.to ? (
                <Link
                  className={styles.statHit}
                  to={stat.to}
                  aria-label={`${stat.label}: ${stat.value}`}
                >
                  <span className={styles.statValue} aria-hidden="true">
                    {stat.value}
                  </span>
                  <span className={styles.statLabel} aria-hidden="true">
                    {stat.label}
                  </span>
                </Link>
              ) : (
                <>
                  <span className={styles.statValue}>{stat.value}</span>
                  <span className={styles.statLabel}>{stat.label}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      {taskEntries.length > 0 && (
        <section className={styles.panel} aria-label="Open tasks by status">
          <h2 className={styles.panelTitle}>Open tasks</h2>
          <ul className={styles.taskCounts}>
            {taskEntries.map(([status, count]) => (
              <li key={status}>
                <span className={`${styles.taskChip} ${taskChipTone(status, count)}`}>
                  {humanizeTaskKey(status)}
                  <span className={styles.taskCount}>{count}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.panel} aria-label="Operational warnings">
        <h2 className={styles.panelTitle}>
          <AlertTriangle size={15} aria-hidden="true" /> Warnings (last 24h)
        </h2>
        {summary.warnings.length === 0 ? (
          <p className={styles.muted}>No warnings. Nothing silently absorbed.</p>
        ) : (
          <ul className={styles.warnList}>
            {summary.warnings.map((warning) => (
              <li key={warning.action} className={styles.warnRow}>
                <StatusBadge tone="warn">{warning.count}</StatusBadge>
                <span>{warningLabel(warning.action)}</span>
                <code className={styles.mono}>{warning.action}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.panel} aria-label="Overdue tasks">
        <h2 className={styles.panelTitle}>Overdue tasks</h2>
        {summary.overdueTasks.length === 0 ? (
          <EmptyState title="Nothing overdue" body="Every open task is inside its SLA window." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Breached</th>
                  <th scope="col">Return</th>
                </tr>
              </thead>
              <tbody>
                {summary.overdueTasks.map((task) => (
                  <tr key={task.id}>
                    <td>{task.title}</td>
                    <td className={styles.mono}>{task.kind}</td>
                    <td>
                      <span className={`${styles.pri} ${priorityTone(task.priority)}`}>{task.priority}</span>
                    </td>
                    <td className={styles.mono}>{formatDate(task.sla_breached_at ?? task.due_at)}</td>
                    <td className={styles.mono}>
                      {task.return_id ? (
                        <Link to={`/warehouse/returns/${task.return_id}`}>Open</Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
