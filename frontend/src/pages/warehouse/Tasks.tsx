import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { TASK_KINDS, TASK_STATUSES, wh } from '../../lib/warehouse'
import type { WarehouseTaskFull } from '../../lib/warehouse'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from './ops.module.css'
import styles from './tasks.module.css'

const PAGE_SIZE = 25

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function formatRemaining(hours: number): string {
  const abs = Math.abs(hours)
  const text = abs < 24 ? `${abs.toFixed(1)}h` : `${Math.floor(abs / 24)}d ${Math.floor(abs % 24)}h`
  return hours < 0 ? `${text} over` : `${text} left`
}

function priorityClass(priority: string): string {
  if (priority === 'URGENT') return ops.priUrgent
  if (priority === 'HIGH') return ops.priHigh
  if (priority === 'NORMAL') return ops.priNormal
  return ops.priLow
}

function shortId(id: string | null): string {
  if (!id) return '—'
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

/** Task lifecycle tones, local to the floor so the shared customer
 * statusTone never changes meaning for shoppers. */
function taskTone(status: string): 'ok' | 'warn' | 'bad' | 'info' {
  if (status === 'COMPLETED') return 'ok'
  if (status === 'BLOCKED') return 'bad'
  if (status === 'IN_PROGRESS') return 'warn'
  return 'info'
}

export default function Tasks() {
  const [statusFilter, setStatusFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [offset, setOffset] = useState(0)
  const [tasks, setTasks] = useState<WarehouseTaskFull[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [blockingId, setBlockingId] = useState<string | null>(null)
  const [blockedReason, setBlockedReason] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
        if (statusFilter !== '') params.set('taskStatus', statusFilter)
        if (kindFilter !== '') params.set('kind', kindFilter)
        if (overdueOnly) params.set('overdueOnly', 'true')
        const data = await wh<{ tasks: WarehouseTaskFull[]; total: number }>(`/tasks?${params.toString()}`)
        if (!cancelled) {
          setTasks(data.tasks)
          setTotal(data.total)
        }
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
  }, [statusFilter, kindFilter, overdueOnly, offset, attempt])

  function resetPaging(): void {
    setOffset(0)
  }

  async function mutate(taskId: string, key: string, path: string, method: string, body?: unknown): Promise<void> {
    setBusy(`${key}-${taskId}`)
    setActionError(null)
    try {
      await wh(path, { method, body })
      setBlockingId(null)
      setBlockedReason('')
      setAttempt((v) => v + 1)
    } catch (err) {
      setActionError(friendlyMessage(err))
    } finally {
      setBusy(null)
    }
  }

  function claim(taskId: string): void {
    void mutate(taskId, 'claim', `/tasks/${taskId}/claim`, 'POST', {})
  }

  function complete(taskId: string): void {
    void mutate(taskId, 'complete', `/tasks/${taskId}`, 'PATCH', { status: 'COMPLETED' })
  }

  function block(taskId: string): void {
    if (blockedReason.trim() === '') {
      setActionError('Give a reason so the next operator knows what is stuck.')
      return
    }
    void mutate(taskId, 'block', `/tasks/${taskId}`, 'PATCH', {
      status: 'BLOCKED',
      blockedReason: blockedReason.trim(),
    })
  }

  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)
  const open = (status: string): boolean => status === 'TODO' || status === 'IN_PROGRESS'

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Floor"
        title="Tasks"
        lede="Work created by the workflow itself — receive, inspect, disposition, approvals. Claim it, do it, close it."
      />

      <div className={styles.toolbar}>
        <label className={styles.filterWrap}>
          <span className={styles.filterLabel}>Status</span>
          <select
            className={styles.filterSelect}
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value)
              resetPaging()
            }}
            aria-label="Filter tasks by status"
          >
            <option value="">All statuses</option>
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterWrap}>
          <span className={styles.filterLabel}>Kind</span>
          <select
            className={styles.filterSelect}
            value={kindFilter}
            onChange={(event) => {
              setKindFilter(event.target.value)
              resetPaging()
            }}
            aria-label="Filter tasks by kind"
          >
            <option value="">All kinds</option>
            {TASK_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.checkWrap}>
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(event) => {
              setOverdueOnly(event.target.checked)
              resetPaging()
            }}
          />
          Overdue only
        </label>
      </div>

      {actionError && (
        <p className={styles.bannerBad} role="alert">
          {actionError}
        </p>
      )}

      {loading ? (
        <LoadingState label="Loading tasks…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
      ) : tasks.length === 0 ? (
        <EmptyState title="No tasks" body="No tasks match these filters. Work creates tasks on its own — there is nothing to add by hand." />
      ) : (
        <>
          <div className={ops.tableWrap}>
            <table className={ops.table}>
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Pri</th>
                  <th scope="col">Status</th>
                  <th scope="col">Due</th>
                  <th scope="col">Assignee</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const isBlocking = blockingId === task.id
                  return (
                    <tr key={task.id}>
                      <td>
                        <span className={styles.taskTitle}>{task.title}</span>
                        <span className={styles.taskSub}>
                          {task.kind.replaceAll('_', ' ')}
                          {task.return_id ? (
                            <>
                              {' · '}
                              <Link className={ops.mono} to={`/warehouse/returns/${task.return_id}`}>
                                {task.returnNumber ?? task.return_id.slice(0, 8)}
                              </Link>
                            </>
                          ) : null}
                          {task.blocked_reason ? ` · Stuck: ${task.blocked_reason}` : ''}
                        </span>
                      </td>
                      <td>
                        <span className={`${ops.pri} ${priorityClass(task.priority)}`}>{task.priority}</span>
                      </td>
                      <td>
                        <StatusBadge tone={taskTone(task.status)}>{task.status.replaceAll('_', ' ')}</StatusBadge>
                      </td>
                      <td className={ops.mono}>
                        {formatDate(task.due_at)}
                        <span className={styles.taskSub}>
                          {task.overdue ? (
                            <span className={ops.flagOverdue}>{formatRemaining(task.hoursRemaining)}</span>
                          ) : (
                            formatRemaining(task.hoursRemaining)
                          )}
                        </span>
                      </td>
                      <td className={ops.mono}>{shortId(task.assigned_to)}</td>
                      <td>
                        {open(task.status) ? (
                          <span className={styles.actions}>
                            {task.status === 'TODO' && (
                              <button
                                type="button"
                                className={styles.actionBtn}
                                disabled={busy !== null}
                                onClick={() => claim(task.id)}
                              >
                                {busy === `claim-${task.id}` ? '…' : 'Claim'}
                              </button>
                            )}
                            <button
                              type="button"
                              className={styles.actionBtn}
                              disabled={busy !== null}
                              onClick={() => complete(task.id)}
                            >
                              {busy === `complete-${task.id}` ? '…' : 'Done'}
                            </button>
                            {!isBlocking ? (
                              <button
                                type="button"
                                className={styles.actionBtn}
                                disabled={busy !== null}
                                onClick={() => {
                                  setBlockingId(task.id)
                                  setBlockedReason('')
                                  setActionError(null)
                                }}
                              >
                                Block
                              </button>
                            ) : (
                              <span className={styles.blockRow}>
                                <input
                                  className={styles.blockInput}
                                  type="text"
                                  placeholder="Why is it stuck?"
                                  aria-label={`Block reason for ${task.title}`}
                                  value={blockedReason}
                                  onChange={(event) => setBlockedReason(event.target.value)}
                                  maxLength={500}
                                />
                                <button
                                  type="button"
                                  className={styles.actionBtn}
                                  disabled={busy !== null}
                                  onClick={() => block(task.id)}
                                >
                                  {busy === `block-${task.id}` ? '…' : 'Save'}
                                </button>
                              </span>
                            )}
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
          <div className={styles.pager}>
            <span className={ops.muted} role="status">
              Showing {from}–{to} of {total}
            </span>
            <span className={styles.pagerBtns}>
              <button
                type="button"
                className={styles.pagerBtn}
                disabled={offset === 0}
                onClick={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
              >
                ← Prev
              </button>
              <button
                type="button"
                className={styles.pagerBtn}
                disabled={to >= total}
                onClick={() => setOffset((v) => v + PAGE_SIZE)}
              >
                Next →
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  )
}
