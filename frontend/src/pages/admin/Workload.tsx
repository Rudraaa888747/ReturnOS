import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ad } from '../../lib/admin'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge, statusTone } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

const PAGE_SIZE = 25

interface WorkloadReturn {
  id: string;
  return_number: string;
  status: string;
  warehouse_id: string | null;
  created_at: string;
}

interface WorkloadTask {
  id: string;
  title: string;
  kind: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  due_at: string;
  warehouse_id: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

export default function Workload() {
  const [status, setStatus] = useState('ALL')
  const [rows, setRows] = useState<WorkloadReturn[]>([])
  const [total, setTotal] = useState(0)
  const [tasks, setTasks] = useState<WorkloadTask[]>([])
  const [tasksTotal, setTasksTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: '0' })
        if (status !== 'ALL') params.set('status', status)
        const data = await ad<{
          returns: WorkloadReturn[];
          returnsTotal: number;
          tasks: WorkloadTask[];
          tasksTotal: number;
        }>(`/workload?${params.toString()}`)
        if (!cancelled) {
          setRows(data.returns)
          setTotal(data.returnsTotal)
          setTasks(data.tasks)
          setTasksTotal(data.tasksTotal)
        }
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 403) {
            setError('This account is not an admin.')
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
  }, [status, attempt])

  return (
    <div className={styles.page}>
      <PageHead kicker="Admin" title="Workload" lede="Open returns and tasks across every site." />

      <div className={styles.toolbar}>
        <label className={styles.filterWrap}>
          <span className={styles.filterLabel}>Return status</span>
          <select
            className={styles.filterSelect}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Filter workload by return status"
          >
            {['ALL', 'REQUESTED', 'APPROVED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED', 'INSPECTION'].map((option) => (
              <option key={option} value={option}>
                {option === 'ALL' ? 'Open returns' : option.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <LoadingState label="Loading workload…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
      ) : (
        <div className={styles.twoCol}>
          <section className={ops.panel} aria-label="Open returns">
            <h2 className={ops.panelTitle}>Open returns ({total})</h2>
            {rows.length === 0 ? (
              <EmptyState title="No open returns" body="No returns match this filter." />
            ) : (
              <ul className={styles.plainList}>
                {rows.map((row) => (
                  <li key={row.id}>
                    <Link className={ops.mono} to={`/admin/returns/${row.id}`}>
                      {row.return_number}
                    </Link>{' '}
                    <StatusBadge tone={statusTone(row.status)}>{row.status.replaceAll('_', ' ')}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={ops.panel} aria-label="Open tasks">
            <h2 className={ops.panelTitle}>Open tasks ({tasksTotal})</h2>
            {tasks.length === 0 ? (
              <EmptyState title="No open tasks" body="No tasks match this filter." />
            ) : (
              <ul className={styles.plainList}>
                {tasks.map((task) => (
                  <li key={task.id}>
                    {task.title}{' '}
                    <span className={ops.muted}>
                      {task.kind.replaceAll('_', ' ')} · {task.status.replaceAll('_', ' ')} · due{' '}
                      {formatDate(task.due_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
