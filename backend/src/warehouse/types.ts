import type {
  ConditionGrade,
  DispositionAction,
  InspectionResult,
  InventoryState,
  LocationKind,
  MovementReason,
  PackageCondition,
  ReceivingDiscrepancy,
  TaskKind,
  TaskPriority,
  TaskStatus,
} from './schema.js';

/**
 * Row shapes for the warehouse tables, mirroring the snake_case columns exactly
 * as better-sqlite3 returns them. API responses map these to camelCase DTOs at
 * the route layer, the way the products route does.
 */

export interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  city: string;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface WarehouseLocationRow {
  id: string;
  warehouse_id: string;
  code: string;
  name: string;
  kind: LocationKind;
  active: number;
  created_at: string;
}

export interface ReceivingRecordRow {
  id: string;
  return_id: string;
  warehouse_id: string;
  location_id: string | null;
  received_by: string;
  tracking_number: string | null;
  carrier: string | null;
  package_condition: PackageCondition;
  discrepancy: ReceivingDiscrepancy;
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
  result: InspectionResult | null;
  notes: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface InspectionItemRow {
  id: string;
  inspection_id: string;
  return_item_id: string;
  result: InspectionResult;
  product_condition: ConditionGrade;
  packaging_condition: ConditionGrade;
  missing_components: string | null;
  damage_notes: string | null;
  serial_number: string | null;
  quantity: number;
  created_at: string;
}

export interface DispositionRow {
  id: string;
  return_item_id: string;
  return_id: string;
  inspection_id: string;
  warehouse_id: string;
  location_id: string | null;
  action: DispositionAction;
  quantity: number;
  reason: string | null;
  notes: string | null;
  recovery_value_paise: number;
  operator_id: string;
  created_at: string;
}

export interface InventoryBucketRow {
  warehouse_id: string;
  product_id: string;
  state: InventoryState;
  quantity: number;
  location_id: string | null;
  updated_at: string;
}

export interface InventoryMovementRow {
  id: string;
  warehouse_id: string;
  product_id: string;
  sku: string;
  quantity: number;
  from_state: InventoryState | null;
  to_state: InventoryState | null;
  from_location_id: string | null;
  to_location_id: string | null;
  reason: MovementReason;
  reference_type: string;
  reference_id: string;
  operator_id: string | null;
  created_at: string;
}

export interface WarehouseTaskRow {
  id: string;
  warehouse_id: string;
  kind: TaskKind;
  title: string;
  return_id: string | null;
  order_id: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  assigned_to: string | null;
  blocked_reason: string | null;
  created_at: string;
  due_at: string;
  started_at: string | null;
  completed_at: string | null;
  sla_breached_at?: string | null;
}

export interface AuditLogRow {
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
