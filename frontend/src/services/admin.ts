import { request } from '../lib/api'
import type { AuditEntry, Page, RecoveryAnalytics, ReturnsAnalytics } from '../lib/types'

export function returnsAnalytics() {
  return request<ReturnsAnalytics>('/api/v1/admin/analytics/returns')
}

export function recoveryAnalytics() {
  return request<RecoveryAnalytics>('/api/v1/admin/analytics/recovery')
}

export function listAudit(params: { entityType?: string; entityId?: string; page?: number; size?: number } = {}) {
  const q = new URLSearchParams()
  if (params.entityType) q.set('entityType', params.entityType)
  if (params.entityId) q.set('entityId', params.entityId)
  q.set('page', String(params.page ?? 0))
  q.set('size', String(params.size ?? 20))
  return request<Page<AuditEntry>>(`/api/v1/audit-logs?${q.toString()}`)
}
