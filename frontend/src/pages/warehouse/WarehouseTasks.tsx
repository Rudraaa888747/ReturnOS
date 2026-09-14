import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../../hooks/useAsync'
import { errorMessage } from '../../lib/api'
import { dateOnly } from '../../lib/format'
import { listTasks, taskAction } from '../../services/operations'
import type { TaskStatus } from '../../lib/types'
import {
  Button,
  EmptyState,
  Field,
  LoadError,
  PageHead,
  Pagination,
  SelectInput,
  Skeleton,
} from '../../components/ui'
import ui from '../../components/ui.module.css'
import { useToast } from '../../components/feedback'
import { PriorityBadge, TaskBadge } from '../../components/status'
import { taskTypeLabel } from '../../lib/format'

export default function WarehouseTasks() {
  const notify = useToast()
  const [mine, setMine] = useState(true)
  const [status, setStatus] = useState<'' | TaskStatus>('')
  const [page, setPage] = useState(0)
  const { data, error, loading, reload } = useAsync(
    () => listTasks({ mine, status: status || undefined, page, size: 12 }),
    [mine, status, page],
  )

  const advance = async (taskId: string, action: 'start' | 'complete') => {
    try {
      await taskAction(taskId, action)
      notify(action === 'start' ? 'Task started.' : 'Task completed. Well done.')
      reload()
    } catch (err) {
      notify(errorMessage(err), 'error')
    }
  }

  return (
    <>
      <PageHead title="My tasks" intro="Work assigned to you, then everything else." />
      <div className={ui.toolbar}>
        <Field label="Scope" htmlFor="t-scope">
          <SelectInput
            id="t-scope"
            value={mine ? 'mine' : 'all'}
            onChange={(e) => {
              setMine(e.target.value === 'mine')
              setPage(0)
            }}
          >
            <option value="mine">Assigned to me</option>
            <option value="all">Everything</option>
          </SelectInput>
        </Field>
        <Field label="Status" htmlFor="t-status">
          <SelectInput
            id="t-status"
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
        <EmptyState title="No tasks here" body="Try a different scope or status." />
      )}
      {data && data.content.length > 0 && (
        <>
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                Operational tasks
              </caption>
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Return</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Status</th>
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
                    <td data-th="Action">
                      {t.status === 'OPEN' && (
                        <Button size="sm" variant="primary" onClick={() => advance(t.id, 'start')}>
                          Start
                        </Button>
                      )}
                      {t.status === 'IN_PROGRESS' && (
                        <Button size="sm" variant="primary" onClick={() => advance(t.id, 'complete')}>
                          Complete
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
