import { db } from '../db.js';
import type { ReceivingRecordRow } from './types.js';

/**
 * Operational reporting.
 *
 * Every figure is an aggregate over rows the warehouse actually wrote. Where
 * there is no data yet the metric is zero or null and says so, rather than
 * being filled with a plausible-looking number.
 */

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
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

/**
 * Inbound return shipments.
 *
 * Carrier and tracking come from the pickup record created when the return was
 * raised. Nothing here contacts a carrier or invents a live tracking status:
 * `pickupStatus` is this system's own view of the parcel.
 */
export function listShipments(limit: number, offset: number): { shipments: InboundShipment[]; total: number } {
  const total = (
    db.prepare('SELECT COUNT(*) AS count FROM pickups').get() as { count: number }
  ).count;

  const shipments = db
    .prepare(
      `SELECT r.id AS returnId, r.return_number AS returnNumber, o.order_number AS orderNumber,
              p.tracking_number AS trackingNumber, p.carrier AS carrier, p.kind AS kind,
              p.status AS pickupStatus, p.date AS pickupDate, p.time_window AS timeWindow,
              p.expected_arrival AS expectedArrival, p.received_at AS receivedAt,
              r.status AS returnStatus
         FROM pickups p
         JOIN returns r ON r.id = p.return_id
         LEFT JOIN orders o ON o.id = r.order_id
        ORDER BY COALESCE(p.received_at, p.date, p.created_at) DESC
        LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as InboundShipment[];

  return { shipments, total };
}

export interface WarehouseAnalytics {
  windowDays: number;
  returnsReceived: number;
  inspectionsCompleted: number;
  pendingInspection: number;
  pendingDisposition: number;
  /** Median-free simple mean, in hours. Null when nothing has completed yet. */
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

function avgHours(rows: Array<{ hours: number | null }>): number | null {
  const values = rows.map((row) => row.hours).filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

export function warehouseAnalytics(warehouseId: string, windowDays: number): WarehouseAnalytics {
  const since = sinceIso(windowDays);

  const returnsReceived = (
    db
      .prepare('SELECT COUNT(*) AS count FROM receiving_records WHERE warehouse_id = ? AND created_at >= ?')
      .get(warehouseId, since) as { count: number }
  ).count;

  const inspectionsCompleted = (
    db
      .prepare(
        'SELECT COUNT(*) AS count FROM inspections WHERE warehouse_id = ? AND completed_at IS NOT NULL AND completed_at >= ?',
      )
      .get(warehouseId, since) as { count: number }
  ).count;

  const pendingInspection = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM receiving_records rec
          JOIN returns r ON r.id = rec.return_id
          WHERE rec.warehouse_id = ?
            AND NOT EXISTS (SELECT 1 FROM inspections i WHERE i.return_id = r.id)`,
      )
      .get(warehouseId) as { count: number }
  ).count;

  const pendingDisposition = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM return_items ri
          JOIN inspections i ON i.return_id = ri.return_id
          WHERE i.warehouse_id = ? AND i.completed_at IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM dispositions d WHERE d.return_item_id = ri.id)`,
      )
      .get(warehouseId) as { count: number }
  ).count;

  // Cycle times, computed from the timestamps the workflow actually recorded.
  const receiveToInspection = db
    .prepare(
      `SELECT (julianday(i.started_at) - julianday(rec.created_at)) * 24.0 AS hours
         FROM inspections i JOIN receiving_records rec ON rec.return_id = i.return_id
        WHERE i.warehouse_id = ? AND i.started_at >= ?`,
    )
    .all(warehouseId, since) as Array<{ hours: number | null }>;

  const inspectionDuration = db
    .prepare(
      `SELECT (julianday(completed_at) - julianday(started_at)) * 1440.0 AS hours
         FROM inspections WHERE warehouse_id = ? AND completed_at IS NOT NULL AND completed_at >= ?`,
    )
    .all(warehouseId, since) as Array<{ hours: number | null }>;

  const receiveToResolution = db
    .prepare(
      `SELECT (julianday(r.updated_at) - julianday(rec.created_at)) * 24.0 AS hours
         FROM returns r JOIN receiving_records rec ON rec.return_id = r.id
        WHERE rec.warehouse_id = ? AND r.status = 'RESOLVED' AND r.updated_at >= ?`,
    )
    .all(warehouseId, since) as Array<{ hours: number | null }>;

  const dispositionsByAction = db
    .prepare(
      `SELECT action, COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS quantity
         FROM dispositions WHERE warehouse_id = ? AND created_at >= ?
        GROUP BY action ORDER BY count DESC`,
    )
    .all(warehouseId, since) as Array<{ action: string; count: number; quantity: number }>;

  const inspectionsByResult = db
    .prepare(
      `SELECT result, COUNT(*) AS count FROM inspections
        WHERE warehouse_id = ? AND result IS NOT NULL AND completed_at >= ?
        GROUP BY result ORDER BY count DESC`,
    )
    .all(warehouseId, since) as Array<{ result: string; count: number }>;

  const recoveryValuePaise = (
    db
      .prepare(
        'SELECT COALESCE(SUM(recovery_value_paise), 0) AS total FROM dispositions WHERE warehouse_id = ? AND created_at >= ?',
      )
      .get(warehouseId, since) as { total: number }
  ).total;

  const movementsByReason = db
    .prepare(
      `SELECT reason, COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS quantity
         FROM inventory_movements WHERE warehouse_id = ? AND created_at >= ?
        GROUP BY reason ORDER BY count DESC`,
    )
    .all(warehouseId, since) as Array<{ reason: string; count: number; quantity: number }>;

  const restockedUnits =
    movementsByReason.find((row) => row.reason === 'RESTOCK')?.quantity ?? 0;
  const damagedUnits = (
    db
      .prepare(
        "SELECT COALESCE(quantity, 0) AS quantity FROM inventory_buckets WHERE warehouse_id = ? AND state = 'DAMAGED'",
      )
      .all(warehouseId) as Array<{ quantity: number }>
  ).reduce((sum, row) => sum + row.quantity, 0);

  const overdueTasks = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM warehouse_tasks
          WHERE warehouse_id = ? AND status IN ('TODO', 'IN_PROGRESS') AND due_at < ?`,
      )
      .get(warehouseId, new Date().toISOString()) as { count: number }
  ).count;

  const warnings = db
    .prepare(
      `SELECT action, COUNT(*) AS count FROM audit_log
        WHERE warehouse_id = ? AND action LIKE 'WARNING_%' AND created_at >= ?
        GROUP BY action ORDER BY count DESC`,
    )
    .all(warehouseId, since) as Array<{ action: string; count: number }>;

  return {
    windowDays,
    returnsReceived,
    inspectionsCompleted,
    pendingInspection,
    pendingDisposition,
    averageReceiveToInspectionHours: avgHours(receiveToInspection),
    averageInspectionMinutes: avgHours(inspectionDuration),
    averageReceiveToResolutionHours: avgHours(receiveToResolution),
    dispositionsByAction,
    inspectionsByResult,
    recoveryValuePaise,
    restockedUnits,
    damagedUnits,
    movementsByReason,
    overdueTasks,
    warnings,
  };
}

/** Recent receiving records, for the shipments screen. */
export function recentReceiving(warehouseId: string, limit: number): ReceivingRecordRow[] {
  return db
    .prepare('SELECT * FROM receiving_records WHERE warehouse_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(warehouseId, limit) as ReceivingRecordRow[];
}
