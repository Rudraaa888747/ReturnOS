import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../../hooks/useAsync'
import { errorMessage } from '../../lib/api'
import { dateOnly, taskTypeLabel } from '../../lib/format'
import { assignTask, listTasks, taskAction } from '../../services/operations'
import {
  Button,
  EmptyState,
  Field,
  LoadError,
  PageHead,
  Pagination,
  SelectInput,
  Skeleton,
  TextInput,
} from '../../components/ui'
import ui from '../../components/ui.module.css'
import { useToast } from '../../components/feedback'
import { PriorityBadge, TaskBadge } from '../../components/status'
import type { TaskStatus } from '../../lib/types'

export default function AdminTasks() {
  const notify = useToast()
  const [status, setStatus] = useState<'' | TaskStatus>('')
  const [page, setPage] = useState(0)
  const [assignee, setAssignee] = useState<Record<string, string>>({})
  const { data, error, loading, reload } = useAsync(
    () => listTasks({ status: status || undefined, page, size: 12 }),
    [status, page],
  )

  const reassign = async (taskId: string) => {
    const userId = (assignee[taskId] ?? '').trim()
    if (!userId) {
      notify('Paste a user UUID to reassign.', 'error')
      return
    }
    try {
      await assignTask(taskId, userId)
      notify('Task reassigned.')
      reload()
    } catch (err) {
      notify(errorMessage(err), 'error')
    }
  }

  const advance = async (taskId: string, action: 'start' | 'complete' | 'cancel') => {
    try {
      await taskAction(taskId, action)
      notify(action === 'complete' ? 'Task completed.' : `Task ${action === 'start' ? 'started' : 'cancelled'}.`)
      reload()
    } catch (err) {
      notify(errorMessage(err), 'error')
    }
  }

  return (
    <>
      <PageHead
        title="All tasks"
        intro="Monitor everything, reassign anyone, resolve the stuck ones. Reassignment needs the user's UUID."
      />
      <div className={ui.toolbar}>
        <Field label="Status" htmlFor="at-status">
          <SelectInput
            id="at-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as '' | TaskStatus)
              setPage(0)
            }}
          >
            <option value="">All</option>
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </SelectInput>
        </Field>
      </div>

      {loading && (
        <>
          <Skeleton height={52} />
          <div style={{ height: 'var(--sp-2)' }} />
          <Skeleton height={52} />
        </>
      )}
      {error && <LoadError error={error} onRetry={reload} />}
      {data && data.content.length === 0 && (
        <EmptyState title="No tasks here" body="Try a different status filter." />
      )}
      {data && data.content.length > 0 && (
        <>
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                All operational tasks
              </caption>
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Return</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Status</th>
                  <th scope="col">Reassign (user UUID)</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.content.map((t) => (
                  <tr key={t.id}>
                    <td data-th="Task">
                      {taskTypeLabel[t.type]}
                      <div className="meta data">{dateOnly(t.createdAt)}</div>
                    </td>
                    <td data-th="Return">
                      <Link to={`/ops/returns/${t.returnId}`} className={ui.rowLink}>
                        Open return
                      </Link>
                    </td>
                    <td data-th="Priority">
                      <PriorityBadge priority={t.priority} />
                    </td>
                    <td data-th="Status">
                      <TaskBadge status={t.status} />
                    </td>
                    <td data-th="Reassign">
                      <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
                        <TextInput
                          aria-label={`Assignee UUID for task ${t.id}`}
                          placeholder="user UUID"
                          value={assignee[t.id] ?? ''}
                          onChange={(e) => setAssignee({ ...assignee, [t.id]: e.target.value })}
                          disabled={t.status === 'COMPLETED' || t.status === 'CANCELLED'}
                        />
                        <Button
                          size="sm"
                          disabled={t.status === 'COMPLETED' || t.status === 'CANCELLED'}
                          onClick={() => void reassign(t.id)}
                        >
                          Set
                        </Button>
                      </div>
                    </td>
                    <td data-th="Action">
                      {t.status === 'OPEN' && (
                        <Button size="sm" onClick={() => void advance(t.id, 'start')}>
                          Start
                        </Button>
                      )}
                      {t.status === 'IN_PROGRESS' && (
                        <Button size="sm" variant="primary" onClick={() => void advance(t.id, 'complete')}>
                          Complete
                        </Button>
                      )}
                      {(t.status === 'OPEN' || t.status === 'IN_PROGRESS') && (
                        <Button size="sm" onClick={() => void advance(t.id, 'cancel')}>
                          Cancel
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={data.number}
            totalPages={data.totalPages}
            totalElements={data.totalElements}
            onPage={setPage}
            label={data.totalElements === 1 ? 'task' : 'tasks'}
          />
        </>
      )}
    </>
  )
}
