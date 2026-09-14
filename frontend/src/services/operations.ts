import { request } from '../lib/api'
import type {
  DisposalRecord,
  Execution,
  OpsTask,
  Page,
  RecoveryRecord,
  RestockRecord,
  ReturnHistory,
  TaskPriority,
  TaskStatus,
  TaskType,
  VendorClaim,
} from '../lib/types'

/* Execution */

export function startExecution(returnId: string, assigneeId?: string, notes?: string) {
  return request<Execution>(`/api/v1/returns/${returnId}/execution/start`, {
    method: 'POST',
    body: { assigneeId: assigneeId ?? null, notes: notes ?? null },
  })
}

export function completeExecution(returnId: string) {
  return request<Execution>(`/api/v1/returns/${returnId}/execution/complete`, { method: 'POST' })
}

export function failExecution(returnId: string, reason: string) {
  return request<Execution>(`/api/v1/returns/${returnId}/execution/fail`, {
    method: 'POST',
    body: { reason },
  })
}

/* Restock */

export function recordRestock(returnId: string, input: { quantity?: number; recoveredQuantity?: number; destination: string }) {
  return request<RestockRecord>(`/api/v1/returns/${returnId}/restock`, { method: 'POST', body: input })
}

/* Vendor claim */

export function openVendorClaim(
  returnId: string,
  input: { vendorReference?: string; expectedCredit?: number; notes?: string },
) {
  return request<VendorClaim>(`/api/v1/returns/${returnId}/vendor-claim`, { method: 'POST', body: input })
}

export function getVendorClaim(returnId: string) {
  return request<VendorClaim>(`/api/v1/returns/${returnId}/vendor-claim`)
}

export function vendorClaimAction(returnId: string, action: 'submit' | 'acknowledge' | 'approve') {
  return request<VendorClaim>(`/api/v1/returns/${returnId}/vendor-claim/${action}`, { method: 'POST' })
}

export function submitVendorClaim(returnId: string) {
  return vendorClaimAction(returnId, 'submit')
}

export function acknowledgeVendorClaim(returnId: string) {
  return vendorClaimAction(returnId, 'acknowledge')
}

export function approveVendorClaim(returnId: string) {
  return vendorClaimAction(returnId, 'approve')
}

export function rejectVendorClaim(returnId: string, reason: string) {
  return request<VendorClaim>(`/api/v1/returns/${returnId}/vendor-claim/reject`, {
    method: 'POST',
    body: { reason },
  })
}

export function settleVendorClaim(returnId: string, actualCredit?: number, notes?: string) {
  return request<VendorClaim>(`/api/v1/returns/${returnId}/vendor-claim/settle`, {
    method: 'POST',
    body: { actualCredit: actualCredit ?? null, notes: notes ?? null },
  })
}

/* Recovery */

export function openRecovery(
  returnId: string,
  input: { channel: string; listedValue?: number; expectedRecovery?: number; notes?: string },
) {
  return request<RecoveryRecord>(`/api/v1/returns/${returnId}/recovery`, { method: 'POST', body: input })
}

export function getRecovery(returnId: string) {
  return request<RecoveryRecord>(`/api/v1/returns/${returnId}/recovery`)
}

export function listRecovery(returnId: string) {
  return request<RecoveryRecord>(`/api/v1/returns/${returnId}/recovery/list`, { method: 'POST' })
}

export function sellRecovery(returnId: string, actualRecovered: number, fees?: number, notes?: string) {
  return request<RecoveryRecord>(`/api/v1/returns/${returnId}/recovery/sell`, {
    method: 'POST',
    body: { actualRecovered, fees: fees ?? null, notes: notes ?? null },
  })
}

export function settleRecovery(returnId: string) {
  return request<RecoveryRecord>(`/api/v1/returns/${returnId}/recovery/settle`, { method: 'POST' })
}

export function correctRecovery(returnId: string, actualRecovered?: number, fees?: number, reason?: string) {
  return request<RecoveryRecord>(`/api/v1/returns/${returnId}/recovery/correct`, {
    method: 'POST',
    body: { actualRecovered: actualRecovered ?? null, fees: fees ?? null, reason },
  })
}



/* Disposal */

export function completeDisposal(
  returnId: string,
  input: { quantity?: number; partner?: string; estimatedRecovery?: number; actualRecovery?: number; processingCost?: number; notes?: string },
) {
  return request<DisposalRecord>(`/api/v1/returns/${returnId}/disposal/complete`, {
    method: 'POST',
    body: input,
  })
}

/* Tasks */

export function listTasks(
  params: { returnId?: string; mine?: boolean; status?: TaskStatus; page?: number; size?: number } = {},
) {
  const q = new URLSearchParams()
  if (params.returnId) q.set('returnId', params.returnId)
  if (params.mine) q.set('mine', 'true')
  if (params.status) q.set('status', params.status)
  q.set('page', String(params.page ?? 0))
  q.set('size', String(params.size ?? 10))
  return request<Page<OpsTask>>(`/api/v1/operations/tasks?${q.toString()}`)
}

export function createTask(input: {
  returnId: string
  type: TaskType
  priority?: TaskPriority
  assigneeId?: string
  executionId?: string
  notes?: string
}) {
  return request<OpsTask>('/api/v1/operations/tasks', { method: 'POST', body: input })
}

export function taskAction(taskId: string, action: 'start' | 'complete' | 'cancel') {
  return request<OpsTask>(`/api/v1/operations/tasks/${taskId}/${action}`, { method: 'POST' })
}

export function startTask(taskId: string) {
  return taskAction(taskId, 'start')
}

export function completeTask(taskId: string) {
  return taskAction(taskId, 'complete')
}

export function assignTask(taskId: string, userId: string) {
  return request<OpsTask>(`/api/v1/operations/tasks/${taskId}/assign`, {
    method: 'POST',
    body: { userId },
  })
}

/* History */

export function getHistory(returnId: string) {
  return request<ReturnHistory>(`/api/v1/returns/${returnId}/history`)
}
