import { useState } from 'react';
import { completeTask, createTask, startTask } from '../../../services/operations';
import { Button, Disclosure, Field, SelectInput, TextInput } from '../../../components/ui';
import { TaskBadge } from '../../../components/status';
import type { OpsTask } from '../../../lib/types';
import type { Runner } from './types';

export function TasksSection({ returnId, tasks, run }: { returnId: string; tasks: OpsTask[]; run: Runner }) {
  const [type, setType] = useState('RESTOCK_ITEM')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const actionable = tasks.some((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS')
  return (
    <Disclosure
      title={`Operational tasks (${tasks.length})`}
      sub="Work items bound to this return."
      open={actionable}
    >
      <form
        style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 'var(--sp-3)' }}
        onSubmit={(e) => {
          e.preventDefault()
          setBusy(true)
          void (async () => {
            try {
              await run(
                () => createTask({ returnId, type: type as OpsTask['type'], notes: notes.trim() || undefined }),
                'Task created.',
              )
              setNotes('')
            } finally {
              setBusy(false)
            }
          })()
        }}
      >
        <Field label="New task" htmlFor="task-type">
          <SelectInput id="task-type" value={type} onChange={(e) => setType(e.target.value)}>
            {['INSPECT_RETURN', 'RESTOCK_ITEM', 'REFURBISH_ITEM', 'SUBMIT_VENDOR_CLAIM', 'SEND_TO_LIQUIDATION', 'PROCESS_RECYCLING', 'SCRAP_ITEM'].map(
              (t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ').toLowerCase()}
                </option>
              ),
            )}
          </SelectInput>
        </Field>
        <Field label="Note (optional)" htmlFor="task-notes">
          <TextInput id="task-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What exactly?" />
        </Field>
        <Button size="sm" type="submit" disabled={busy}>
          Add task
        </Button>
      </form>
      {tasks.length === 0 ? (
        <p className="meta">No tasks yet. Create the first piece of work above.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} run={run} />
          ))}
        </ul>
      )}
    </Disclosure>
  )
}

function TaskRow({ task, run }: { task: OpsTask; run: Runner }) {
  return (
    <li
      style={{
        display: 'flex',
        gap: 'var(--sp-2)',
        alignItems: 'center',
        padding: 'var(--sp-2) 0',
        borderTop: '1px solid var(--line)',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ flex: 1, minWidth: 160 }}>
        {task.type.replace(/_/g, ' ').toLowerCase()}
        {task.notes && <span className="meta"> — {task.notes}</span>}
      </span>
      <TaskBadge status={task.status} />
      {task.status === 'OPEN' && (
        <Button size="sm" onClick={() => void run(() => startTask(task.id), 'Task started.')}>
          Start
        </Button>
      )}
      {task.status === 'IN_PROGRESS' && (
        <Button size="sm" variant="primary" onClick={() => void run(() => completeTask(task.id), 'Task completed.')}>
          Complete
        </Button>
      )}
    </li>
  )
}


