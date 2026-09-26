/* Typed client for the ReturnOS warehouse API.
 * Same conventions as lib/api (token header, JSON errors), scoped to the
 * /api/v1/warehouse namespace. The frontend never computes business outcomes
 * here — it only renders server state and posts operator actions.
 */

import { ApiError, getToken } from './api';
import type { ApiErrorBody } from './api';

const WAREHOUSE_BASE = `${import.meta.env.VITE_API_URL ?? ''}/api/v1/warehouse`;

interface WhOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export async function wh<T>(path: string, options: WhOptions = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${WAREHOUSE_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body: ApiErrorBody =
      typeof data === 'object' && data !== null && 'code' in data
        ? (data as ApiErrorBody)
        : { code: 'REQUEST_FAILED', message: `Request failed with status ${response.status}` };
    throw new ApiError(response.status, body);
  }
  return data as T;
}

/* ------------------------------------------------------------------ */
/* Shapes mirroring the warehouse API responses.                       */
/* ------------------------------------------------------------------ */

export interface WarehouseLocation {
  id: string;
  code: string;
  name: string;
  kind: string;
}

export interface WarehouseContext {
  operator: { id: string; role: string };
  warehouse: { id: string; code: string; name: string; city: string };
  locations: WarehouseLocation[];
}

export type QueuePriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface QueueRow {
  returnId: string;
  returnNumber: string;
  orderId: string;
  orderNumber: string | null;
  customerRef: string;
  productName: string | null;
  sku: string | null;
  imageUrl: string | null;
  quantity: number;
  reasonCode: string | null;
  status: string;
  resolutionType: string | null;
  createdAt: string;
  updatedAt: string;
  trackingNumber: string | null;
  carrier: string | null;
  receivedAt: string | null;
  inspectionStartedAt: string | null;
  inspectionCompletedAt: string | null;
  dispositionsDone: number;
  lineCount: number;
  ageHours: number;
  priority: QueuePriority;
  slaDueAt: string;
  overdue: boolean;
}

export interface WarehouseReturnLine {
  returnItemId: string;
  orderItemId: string;
  productId: string;
  sku: string;
  productName: string;
  imageUrl: string | null;
  quantity: number;
  reasonCode: string;
  description: string | null;
}

export interface ReceivingRecord {
  id: string;
  return_id: string;
  warehouse_id: string;
  location_id: string | null;
  received_by: string;
  tracking_number: string | null;
  carrier: string | null;
  package_condition: string;
  discrepancy: string;
  expected_quantity: number;
  received_quantity: number;
  notes: string | null;
  created_at: string;
}

export interface InspectionRow {
  id: string;
  return_id: string;
  warehouse_id: string;
  inspected_by: string;
  result: string | null;
  notes: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface InspectionItemRow {
  id: string;
  inspection_id: string;
  return_item_id: string;
  result: string;
  product_condition: string;
  packaging_condition: string;
  missing_components: string | null;
  damage_notes: string | null;
  serial_number: string | null;
  quantity: number;
  created_at: string;
}

export interface InspectionDetail {
  inspection: InspectionRow;
  items: InspectionItemRow[];
  /** Dispositions the backend will accept per return-item id. */
  allowedDispositions: Record<string, string[]>;
}

export interface DispositionRow {
  id: string;
  return_item_id: string;
  return_id: string;
  inspection_id: string;
  warehouse_id: string;
  location_id: string | null;
  action: string;
  quantity: number;
  reason: string | null;
  notes: string | null;
  recovery_value_paise: number;
  operator_id: string;
  created_at: string;
}

export interface ReturnTimelineEvent {
  id: string;
  status: string;
  description: string | null;
  created_at: string;
}

export interface ReturnDocument {
  id: string;
  kind: string;
  filename: string;
  mime: string;
  size: number;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  actor_id: string | null;
  actor_role: string;
  warehouse_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  previous_state: string | null;
  new_state: string | null;
  metadata: string | null;
  created_at: string;
}

export interface WarehouseReturnDetail {
  summary: QueueRow;
  lines: WarehouseReturnLine[];
  receiving: ReceivingRecord | null;
  inspection: InspectionDetail | null;
  dispositions: DispositionRow[];
  timeline: ReturnTimelineEvent[];
  documents: ReturnDocument[];
  audit: AuditEntry[];
}

export interface WarehouseTask {
  id: string;
  warehouse_id: string;
  kind: string;
  title: string;
  return_id: string | null;
  order_id: string | null;
  priority: QueuePriority;
  status: string;
  assigned_to: string | null;
  blocked_reason: string | null;
  created_at: string;
  due_at: string;
  started_at: string | null;
  completed_at: string | null;
  sla_breached_at?: string | null;
}

export interface SummaryWarning {
  action: string;
  count: number;
}

export interface WarehouseSummary {
  awaitingArrival: number;
  pendingInspection: number;
  inInspection: number;
  pendingApproval: number;
  resolved: number;
  overdue: number;
  movementsToday: number;
  tasks: Record<string, number>;
  overdueTasks: WarehouseTask[];
  warnings: SummaryWarning[];
}

/** Stages an operator can still work, in floor order. */
export const WORKABLE_STATUSES = ['APPROVED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED', 'INSPECTION'] as const;

/** Plain-language rendering of the WARNING_* audit actions. */
export function warningLabel(action: string): string {
  switch (action) {
    case 'WARNING_INVENTORY_CLAMPED':
      return 'Inventory clamp — bucket held less than the sale needed'
    case 'WARNING_RECEIVED_BEFORE_APPROVAL':
      return 'Parcel received before the claim was approved'
    case 'WARNING_TASK_OVERDUE':
      return 'Task passed its SLA'
    case 'WARNING_REPLACEMENT_SHORTFALL':
      return 'Replacement shipped short of sellable stock'
    case 'WARNING_RESOLUTION_WAREHOUSE_FALLBACK':
      return 'Resolution shipped from the default pool (no receiving record)'
    default:
      return action.replaceAll('_', ' ').toLowerCase()
  }
}

export interface InventoryLine {
  productId: string;
  sku: string;
  name: string;
  imageUrl: string | null;
  states: Record<string, number>;
  sellableStock: number;
}

export interface InventoryBucket {
  warehouse_id: string;
  product_id: string;
  state: string;
  quantity: number;
  location_id: string | null;
  updated_at: string;
}

export interface InventoryMovement {
  id: string;
  warehouse_id: string;
  product_id: string;
  sku: string;
  quantity: number;
  from_state: string | null;
  to_state: string | null;
  from_location_id: string | null;
  to_location_id: string | null;
  reason: string;
  reference_type: string;
  reference_id: string;
  operator_id: string | null;
  created_at: string;
}

export interface InboundShipment {
  returnId: string;
  returnNumber: string;
  orderNumber: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  kind: string;
  pickupStatus: string;
  pickupDate: string | null;
  timeWindow: string | null;
  expectedArrival: string | null;
  receivedAt: string | null;
  returnStatus: string;
}

export interface AnalyticsBreakdown {
  action?: string;
  result?: string;
  reason?: string;
  count: number;
  quantity?: number;
}

export interface WarehouseAnalytics {
  windowDays: number;
  returnsReceived: number;
  inspectionsCompleted: number;
  pendingInspection: number;
  pendingDisposition: number;
  averageReceiveToInspectionHours: number | null;
  averageInspectionMinutes: number | null;
  averageReceiveToResolutionHours: number | null;
  dispositionsByAction: Array<{ action: string; count: number; quantity: number }>;
  inspectionsByResult: Array<{ result: string; count: number }>;
  recoveryValuePaise: number;
  restockedUnits: number;
  damagedUnits: number;
  movementsByReason: Array<{ reason: string; count: number; quantity: number }>;
  overdueTasks: number;
  warnings: Array<{ action: string; count: number }>;
}

export interface WarehouseTaskFull extends WarehouseTask {
  hoursRemaining: number;
  overdue: boolean;
  returnNumber: string | null;
  orderNumber: string | null;
}

export const TASK_KINDS = [
  'RECEIVE_RETURN',
  'INSPECT_ITEM',
  'PROCESS_DISPOSITION',
  'REVIEW_APPROVAL',
  'RESTOCK',
  'PACKAGE_REPLACEMENT',
  'PREPARE_EXCHANGE',
  'VERIFY_SHIPMENT',
] as const;

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'] as const;
