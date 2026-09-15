import { ApiRequestError } from '../../../lib/api';
import {
  getDisposition,
  getExecution,
  getInspection,
  getReturn,
  getRisk,
} from '../../../services/returns';
import {
  getHistory,
  getRecovery,
  getVendorClaim,
  listTasks,
} from '../../../services/operations';
import type {
  DispositionEvaluation,
  Execution,
  Inspection,
  OpsTask,
  RecoveryRecord,
  ReturnHistory,
  ReturnOrder,
  RiskAssessment,
  VendorClaim,
} from '../../../lib/types';

/* Shared workspace model: aggregate shape, loading and the action-runner type. */

export interface WorkspaceData {
  ret: ReturnOrder
  history: ReturnHistory
  inspection: Inspection | null
  risk: RiskAssessment | null
  disposition: DispositionEvaluation | null
  execution: Execution | null
  vendor: VendorClaim | null
  recovery: RecoveryRecord | null
  tasks: OpsTask[]
}

export async function nullOn404<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) return null
    throw e
  }
}

export async function loadWorkspace(id: string): Promise<WorkspaceData> {
  const [ret, history] = await Promise.all([getReturn(id), getHistory(id)])
  const [inspection, risk, disposition, execution, tasks] = await Promise.all([
    nullOn404(() => getInspection(id)),
    nullOn404(() => getRisk(id)),
    nullOn404(() => getDisposition(id)),
    nullOn404(() => getExecution(id)),
    listTasks({ returnId: id, page: 0, size: 50 }).then((p) => p.content),
  ])
  const [vendor, recovery] = await Promise.all([
    execution ? nullOn404(() => getVendorClaim(id)) : null,
    execution ? nullOn404(() => getRecovery(id)) : null,
  ])
  return { ret, history, inspection, risk, disposition, execution, vendor, recovery, tasks }
}

export type Runner = (fn: () => Promise<unknown>, ok: string) => Promise<void>

