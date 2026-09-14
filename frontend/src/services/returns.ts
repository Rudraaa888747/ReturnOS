import { request } from '../lib/api'
import type {
  Disposition,
  DispositionEvaluation,
  Execution,
  Inspection,
  Page,
  ReceiveMode,
  ReturnOrder,
  ReturnReason,
  ReturnStatus,
  RiskAssessment,
} from '../lib/types'

export interface NewReturnItem {
  orderItemId: string
  quantity: number
  reason: ReturnReason
  description?: string
}

export function createReturn(orderId: string, items: NewReturnItem[]) {
  return request<ReturnOrder>('/api/v1/returns', { method: 'POST', body: { orderId, items } })
}

export function listReturns(params: { status?: ReturnStatus; page?: number; size?: number } = {}) {
  const q = new URLSearchParams()
  if (params.status) q.set('status', params.status)
  q.set('page', String(params.page ?? 0))
  q.set('size', String(params.size ?? 10))
  return request<Page<ReturnOrder>>(`/api/v1/returns?${q.toString()}`)
}

export function getReturn(id: string) {
  return request<ReturnOrder>(`/api/v1/returns/${id}`)
}

export function approveReturn(id: string) {
  return request<ReturnOrder>(`/api/v1/returns/${id}/approve`, { method: 'POST' })
}

export function rejectReturn(id: string, reason: string) {
  return request<ReturnOrder>(`/api/v1/returns/${id}/reject`, { method: 'POST', body: { reason } })
}

export function shipReturn(id: string) {
  return request<ReturnOrder>(`/api/v1/returns/${id}/ship`, { method: 'POST' })
}

export function receiveReturn(id: string, mode: ReceiveMode) {
  return request<ReturnOrder>(`/api/v1/returns/${id}/receive`, { method: 'POST', body: { mode } })
}

export interface InspectionInput {
  physicalCondition: string
  packagingCondition: string
  accessoriesComplete: boolean
  functionalTestResult: string
  visibleDamage?: string
  notes?: string
}

export function submitInspection(returnId: string, input: InspectionInput) {
  return request<Inspection>(`/api/v1/returns/${returnId}/inspection`, { method: 'POST', body: input })
}

export function getInspection(returnId: string) {
  return request<Inspection>(`/api/v1/returns/${returnId}/inspection`)
}

export function assessRisk(returnId: string) {
  return request<RiskAssessment>(`/api/v1/returns/${returnId}/risk/assess`, { method: 'POST' })
}

export function getRisk(returnId: string) {
  return request<RiskAssessment>(`/api/v1/returns/${returnId}/risk`)
}

export function evaluateDisposition(returnId: string) {
  return request<DispositionEvaluation>(`/api/v1/returns/${returnId}/disposition/evaluate`, {
    method: 'POST',
  })
}

export function getDisposition(returnId: string) {
  return request<DispositionEvaluation>(`/api/v1/returns/${returnId}/disposition`)
}

export function finalizeDisposition(returnId: string, disposition?: Disposition, overrideReason?: string) {
  return request<DispositionEvaluation>(`/api/v1/returns/${returnId}/disposition/finalize`, {
    method: 'POST',
    body: { disposition: disposition ?? null, overrideReason: overrideReason ?? null },
  })
}

export function overrideDisposition(returnId: string, disposition: Disposition, reason: string) {
  return request<DispositionEvaluation>(`/api/v1/returns/${returnId}/disposition/override`, {
    method: 'POST',
    body: { disposition, reason },
  })
}

export function getExecution(returnId: string) {
  return request<Execution>(`/api/v1/returns/${returnId}/execution`)
}
