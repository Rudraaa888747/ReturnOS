import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Workspace from './Workspace'
import * as returnsApi from '../../services/returns'
import { ApiRequestError } from '../../lib/api'
import * as opsApi from '../../services/operations'
import { useAuth } from '../../auth/AuthContext'
import type { ReturnHistory, ReturnOrder } from '../../lib/types'
import { ToastProvider } from '../../components/feedback'

vi.mock('../../services/returns')
vi.mock('../../services/operations')
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }))

const staffUser = { id: 's1', email: 's@x.dev', fullName: 'Staff', role: 'WAREHOUSE_STAFF', enabled: true } as const

const baseReturn = {
  id: 'r1',
  returnNumber: 'RET-1',
  orderId: 'o1',
  customerId: 'c1',
  status: 'RECEIVED',
  requestedAt: '2026-09-01T10:00:00Z',
  approvedAt: '2026-09-02T10:00:00Z',
  rejectedAt: null,
  rejectionReason: null,
  receivedAt: '2026-09-05T10:00:00Z',
  createdAt: '2026-09-01T10:00:00Z',
  items: [
    { id: 'i1', orderItemId: 'oi1', productId: 'p1', sku: 'SKU-1', quantity: 1, reason: 'DEFECTIVE', description: null },
  ],
} as unknown as ReturnOrder

const emptyHistory = {
  returnId: 'r1',
  returnNumber: 'RET-1',
  status: 'RECEIVED',
  requestedAt: '2026-09-01T10:00:00Z',
  createdAt: '2026-09-01T10:00:00Z',
  inspection: null,
  risk: null,
  disposition: null,
  execution: null,
  restock: null,
  vendorClaim: null,
  recovery: null,
  disposal: null,
  tasks: [],
  events: [],
} as unknown as ReturnHistory

const NOT_FOUND = () => new ApiRequestError(404, 'NOT_FOUND', 'missing');

function renderWorkspace(inspection: unknown = NOT_FOUND()) {
  vi.mocked(useAuth).mockReturnValue({ user: staffUser, ready: true } as never)
  vi.mocked(returnsApi.getReturn).mockResolvedValue(baseReturn)
  vi.mocked(opsApi.getHistory).mockResolvedValue(emptyHistory)
  if (inspection instanceof Error) vi.mocked(returnsApi.getInspection).mockRejectedValue(inspection)
  else vi.mocked(returnsApi.getInspection).mockResolvedValue(inspection as never)
  vi.mocked(returnsApi.getRisk).mockRejectedValue(new ApiRequestError(404, 'NOT_FOUND', 'missing'))
  vi.mocked(returnsApi.getDisposition).mockRejectedValue(new ApiRequestError(404, 'NOT_FOUND', 'missing'))
  vi.mocked(returnsApi.getExecution).mockRejectedValue(new ApiRequestError(404, 'NOT_FOUND', 'missing'))
  vi.mocked(opsApi.listTasks).mockResolvedValue({ content: [], totalElements: 0, totalPages: 0, number: 0, size: 50 })
  vi.mocked(opsApi.getVendorClaim).mockRejectedValue(new ApiRequestError(404, 'NOT_FOUND', 'missing'))
  vi.mocked(opsApi.getRecovery).mockRejectedValue(new ApiRequestError(404, 'NOT_FOUND', 'missing'))

  return render(
    <MemoryRouter initialEntries={['/ops/returns/r1']}>
      <ToastProvider>
        <Routes>
          <Route path="/ops/returns/:id" element={<Workspace />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('Workspace', () => {
  it('shows the inspection form for a received return and submits it', async () => {
    const user = userEvent.setup()
    const submitted = {
      id: 'in1',
      returnId: 'r1',
      physicalCondition: 'GOOD',
      packagingCondition: 'OPENED',
      accessoriesComplete: true,
      functionalTestResult: 'PASSED',
      visibleDamage: null,
      notes: null,
      inspectedBy: 's1',
      inspectedAt: '2026-09-06T10:00:00Z',
    }
    vi.mocked(returnsApi.submitInspection).mockResolvedValue(submitted as never)
    renderWorkspace()

    expect(await screen.findByText('RET-1')).toBeInTheDocument()
    expect(await screen.findByText('Record what is on the bench. Be precise — disposition depends on this.')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Functional test'), 'PASSED')
    await user.click(screen.getByRole('button', { name: 'Complete inspection' }))

    expect(returnsApi.submitInspection).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ physicalCondition: 'GOOD', functionalTestResult: 'PASSED' }),
    )
  })

  it('offers risk assessment once inspection exists', async () => {
    renderWorkspace({
      id: 'in1',
      returnId: 'r1',
      physicalCondition: 'GOOD',
      packagingCondition: 'OPENED',
      accessoriesComplete: true,
      functionalTestResult: 'PASSED',
      visibleDamage: null,
      notes: null,
      inspectedBy: 's1',
      inspectedAt: '2026-09-06T10:00:00Z',
    })

    expect(await screen.findByRole('button', { name: 'Assess risk' })).toBeInTheDocument()
  })
})
