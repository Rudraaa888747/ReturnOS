import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import WarehouseTasks from './WarehouseTasks'
import { listTasks, taskAction } from '../../services/operations'
import { useAuth } from '../../auth/AuthContext'
import { ToastProvider } from '../../components/feedback'
import type { OpsTask, Page } from '../../lib/types'

vi.mock('../../services/operations')
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }))

const staff = { id: 's1', email: 's@x.dev', fullName: 'Staff', role: 'WAREHOUSE_STAFF', enabled: true }

function makeTask(id: string, status: OpsTask['status']): OpsTask {
  return {
    id,
    returnId: 'r1',
    executionId: null,
    type: 'RESTOCK_ITEM',
    status,
    priority: 'MEDIUM',
    assigneeId: 's1',
    createdBy: 's1',
    createdAt: '2026-09-01T10:00:00Z',
    startedAt: null,
    completedAt: null,
    notes: null,
  }
}

function renderPage(tasks: OpsTask[]) {
  vi.mocked(useAuth).mockReturnValue({ user: staff, ready: true } as never)
  vi.mocked(listTasks).mockResolvedValue({
    content: tasks,
    totalElements: tasks.length,
    totalPages: 1,
    number: 0,
    size: 12,
  } satisfies Page<OpsTask>)
  return render(
    <MemoryRouter initialEntries={['/ops/tasks']}>
      <ToastProvider>
        <Routes>
          <Route path="/ops/tasks" element={<WarehouseTasks />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('WarehouseTasks cancel action', () => {
  it('shows Start+Cancel for OPEN and Complete+Cancel for IN_PROGRESS, nothing terminal otherwise', async () => {
    renderPage([makeTask('t-open', 'OPEN'), makeTask('t-prog', 'IN_PROGRESS'), makeTask('t-done', 'COMPLETED'), makeTask('t-canc', 'CANCELLED')])
    const table = await screen.findByRole('table', { name: 'Operational tasks' })
    const rows = within(table).getAllByRole('row').slice(1)

    expect(within(rows[0]).getByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(within(rows[0]).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(rows[0]).queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument()

    expect(within(rows[1]).getByRole('button', { name: 'Complete' })).toBeInTheDocument()
    expect(within(rows[1]).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(rows[1]).queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()

    expect(within(rows[2]).queryByRole('button')).not.toBeInTheDocument()
    expect(within(rows[3]).queryByRole('button')).not.toBeInTheDocument()
  })

  it('confirms before cancelling and invokes the cancel action', async () => {
    const user = userEvent.setup()
    vi.mocked(taskAction).mockResolvedValue(makeTask('t-open', 'CANCELLED'))
    renderPage([makeTask('t-open', 'OPEN')])

    const table = await screen.findByRole('table', { name: 'Operational tasks' })
    const row = within(table).getAllByRole('row')[1]
    await user.click(within(row).getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText('Cancel this task?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel task' }))
    expect(vi.mocked(taskAction)).toHaveBeenCalledWith('t-open', 'cancel')
  })

  it('never offers Delete', async () => {
    renderPage([makeTask('t-open', 'OPEN')])
    await screen.findByRole('table', { name: 'Operational tasks' })
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('disables actions while one is in flight', async () => {
    const user = userEvent.setup()
    let release!: () => void
    vi.mocked(taskAction).mockImplementation(() => new Promise((resolve) => (release = resolve as never)))
    renderPage([makeTask('t-open', 'OPEN'), makeTask('t-open-2', 'OPEN')])

    const table = await screen.findByRole('table', { name: 'Operational tasks' })
    const rows = within(table).getAllByRole('row').slice(1)
    await user.click(within(rows[0]).getByRole('button', { name: 'Start' }))
    expect(within(rows[1]).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    release()
  })
})
