import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskRow } from './TasksSection'
import { cancelTask } from '../../../services/operations'
import type { OpsTask } from '../../../lib/types'

vi.mock('../../../services/operations', () => ({
  completeTask: vi.fn(),
  startTask: vi.fn(),
  cancelTask: vi.fn(),
  createTask: vi.fn(),
}))

function makeTask(status: OpsTask['status']): OpsTask {
  return {
    id: 't1',
    returnId: 'r1',
    executionId: null,
    type: 'RESTOCK_ITEM',
    status,
    priority: 'MEDIUM',
    assigneeId: null,
    createdBy: null,
    createdAt: '2026-09-01T10:00:00Z',
    startedAt: null,
    completedAt: null,
    notes: null,
  }
}

const run = async (fn: () => Promise<unknown>) => {
  await fn()
}

describe('TaskRow cancel', () => {
  it('cancels an OPEN task after confirmation', async () => {
    const user = userEvent.setup()
    render(<TaskRow task={makeTask('OPEN')} run={run} />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Cancel this task?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel task' }))

    expect(vi.mocked(cancelTask)).toHaveBeenCalledWith('t1')
  })

  it('cancels an IN_PROGRESS task and hides actions when done', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<TaskRow task={makeTask('IN_PROGRESS')} run={run} />)

    expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Cancel task' }))
    expect(vi.mocked(cancelTask)).toHaveBeenCalledWith('t1')

    rerender(<TaskRow task={makeTask('COMPLETED')} run={run} />)
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })
})
