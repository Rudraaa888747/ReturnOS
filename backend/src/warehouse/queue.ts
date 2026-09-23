import { db } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { getTaskSlaHours } from '../admin/settings.js';
import type { ReceivingRecordRow } from './types.js';

/**
 * The warehouse view of returns.
 *
 * Warehouse users see what they need to process a parcel: the goods, the
 * reason, the shipment and the resolution. They do not get the customer's
 * email, phone or address book — the pickup address is included because a
 * parcel cannot be traced without it, but nothing else about the person is.
 */

/** Stages that still need work on the floor, in the order they are worked. */
export const WORKABLE_STATUSES = ['APPROVED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED', 'INSPECTION'] as const;

export interface QueueRow {
  returnId: string;
  returnNumber: string;
  orderId: string;
  orderNumber: string | null;
  /** Short customer reference, never the full identity. */
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
  /** Hours since the return was created. */
  ageHours: number;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  slaDueAt: string;
  overdue: boolean;
}

/**
 * Priority is derived, not stored: it follows how long a return has been
 * waiting against the SLA for the stage it is in. Nothing is fabricated.
 */
function stageSlaHours(status: string): number {
  const sla = getTaskSlaHours();
  switch (status) {
    case 'RECEIVED':
      return sla.INSPECT_ITEM;
    case 'INSPECTION':
      return sla.PROCESS_DISPOSITION;
    default:
      return sla.RECEIVE_RETURN;
  }
}

function hoursBetween(from: string, to: number): number {
  const start = new Date(from).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, (to - start) / 3_600_000);
}

function priorityFor(ageHours: number, slaHours: number, reasonCode: string | null): QueueRow['priority'] {
  const ratio = slaHours === 0 ? 0 : ageHours / slaHours;
  if (ratio >= 1) return 'URGENT';
  if (ratio >= 0.75) return 'HIGH';
  // Safety-relevant reasons jump the queue regardless of age.
  if (reasonCode === 'DEFECTIVE' || reasonCode === 'DAMAGED') return 'HIGH';
  if (ratio >= 0.4) return 'NORMAL';
  return 'LOW';
}

interface RawQueueRow {
  returnId: string;
  returnNumber: string;
  orderId: string;
  orderNumber: string | null;
  customerId: string;
  status: string;
  resolutionType: string | null;
  createdAt: string;
  updatedAt: string;
  productName: string | null;
  sku: string | null;
  imageUrl: string | null;
  quantity: number | null;
  reasonCode: string | null;
  lineCount: number;
  trackingNumber: string | null;
  carrier: string | null;
  receivedAt: string | null;
  inspectionStartedAt: string | null;
  inspectionCompletedAt: string | null;
  dispositionsDone: number;
}

const QUEUE_SELECT = `
  SELECT r.id AS returnId, r.return_number AS returnNumber, r.order_id AS orderId,
         o.order_number AS orderNumber, r.customer_id AS customerId, r.status AS status,
         r.resolution_type AS resolutionType, r.created_at AS createdAt, r.updated_at AS updatedAt,
         (SELECT oi.product_name FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
           WHERE ri.return_id = r.id LIMIT 1) AS productName,
         (SELECT oi.sku FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
           WHERE ri.return_id = r.id LIMIT 1) AS sku,
         (SELECT oi.product_image_url FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
           WHERE ri.return_id = r.id LIMIT 1) AS imageUrl,
         (SELECT SUM(ri.quantity) FROM return_items ri WHERE ri.return_id = r.id) AS quantity,
         (SELECT ri.reason_code FROM return_items ri WHERE ri.return_id = r.id LIMIT 1) AS reasonCode,
         (SELECT COUNT(*) FROM return_items ri WHERE ri.return_id = r.id) AS lineCount,
         p.tracking_number AS trackingNumber, p.carrier AS carrier,
         rec.created_at AS receivedAt,
         insp.started_at AS inspectionStartedAt, insp.completed_at AS inspectionCompletedAt,
         (SELECT COUNT(*) FROM dispositions d WHERE d.return_id = r.id) AS dispositionsDone
    FROM returns r
    LEFT JOIN orders o ON o.id = r.order_id
    LEFT JOIN pickups p ON p.return_id = r.id
    LEFT JOIN receiving_records rec ON rec.return_id = r.id
    LEFT JOIN inspections insp ON insp.return_id = r.id
`;

/** A stable, non-identifying reference to the customer. */
function customerRef(customerId: string): string {
  // Last six alphanumerics only: raw ids can end in separators (e.g. the demo
  // `u-demo-rudra` ends in `-rudra`), which used to render as `CUS--RUDRA`.
  const suffix = customerId.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase().padStart(6, '0');
  return `CUS-${suffix}`;
}

function decorate(row: RawQueueRow, now: number): QueueRow {
  const slaHours = stageSlaHours(row.status);
  const ageHours = hoursBetween(row.createdAt, now);
  const slaDueAt = new Date(new Date(row.createdAt).getTime() + slaHours * 3_600_000).toISOString();
  return {
    returnId: row.returnId,
    returnNumber: row.returnNumber,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    customerRef: customerRef(row.customerId),
    productName: row.productName,
    sku: row.sku,
    imageUrl: row.imageUrl,
    quantity: row.quantity ?? 0,
    reasonCode: row.reasonCode,
    status: row.status,
    resolutionType: row.resolutionType,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    trackingNumber: row.trackingNumber,
    carrier: row.carrier,
    receivedAt: row.receivedAt,
    inspectionStartedAt: row.inspectionStartedAt,
    inspectionCompletedAt: row.inspectionCompletedAt,
    dispositionsDone: row.dispositionsDone,
    lineCount: row.lineCount,
    ageHours: Math.round(ageHours * 10) / 10,
    priority: priorityFor(ageHours, slaHours, row.reasonCode),
    slaDueAt,
    overdue: ageHours > slaHours,
  };
}

export interface QueueQuery {
  status?: string;
  search?: string;
  limit: number;
  offset: number;
}

/**
 * Site visibility for one warehouse: unreceived arrivals belong to every
 * dock (any of them may receive the parcel), received work belongs to the
 * dock holding it. Shared by the list, the entry lookup and the counts so
 * the three can never disagree about what a site may see.
 */
function siteCondition(): string {
  return `(
    NOT EXISTS (SELECT 1 FROM receiving_records rr WHERE rr.return_id = r.id)
    OR EXISTS (SELECT 1 FROM receiving_records rr WHERE rr.return_id = r.id AND rr.warehouse_id = ?)
  )`;
}

/** The return queue. Filtering happens in SQL so paging stays correct. */
export function listQueue(query: QueueQuery, warehouseId: string): { returns: QueueRow[]; total: number } {
  const filters: string[] = [];
  const params: unknown[] = [];

  filters.push(siteCondition());
  params.push(warehouseId);

  if (query.status !== undefined && query.status !== 'ALL') {
    filters.push('r.status = ?');
    params.push(query.status);
  } else {
    filters.push(`r.status IN (${WORKABLE_STATUSES.map(() => '?').join(', ')})`);
    params.push(...WORKABLE_STATUSES);
  }

  if (query.search !== undefined && query.search.trim() !== '') {
    const term = `%${query.search.trim().toLowerCase()}%`;
    filters.push(`(
      LOWER(r.return_number) LIKE ? OR LOWER(o.order_number) LIKE ? OR LOWER(p.tracking_number) LIKE ?
      OR EXISTS (SELECT 1 FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
                  WHERE ri.return_id = r.id AND (LOWER(oi.sku) LIKE ? OR LOWER(oi.product_name) LIKE ?))
    )`);
    params.push(term, term, term, term, term);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM returns r
           LEFT JOIN orders o ON o.id = r.order_id
           LEFT JOIN pickups p ON p.return_id = r.id
         ${where}`,
      )
      .get(...params) as { count: number }
  ).count;

  const rows = db
    .prepare(`${QUEUE_SELECT} ${where} ORDER BY r.created_at ASC LIMIT ? OFFSET ?`)
    .all(...params, query.limit, query.offset) as RawQueueRow[];

  const now = Date.now();
  return { returns: rows.map((row) => decorate(row, now)), total };
}

/** One return, in warehouse shape. */
export function queueEntry(returnId: string, warehouseId: string): QueueRow {
  const row = db.prepare(`${QUEUE_SELECT} WHERE r.id = ?`).get(returnId) as RawQueueRow | undefined;
  if (row === undefined) {
    throw new HttpError(404, 'RETURN_NOT_FOUND', 'Return not found');
  }
  const site = db.prepare('SELECT warehouse_id FROM receiving_records WHERE return_id = ?').get(returnId) as
    | { warehouse_id: string }
    | undefined;
  if (site !== undefined && site.warehouse_id !== warehouseId) {
    // Another dock's work reads exactly like a missing return.
    throw new HttpError(404, 'RETURN_NOT_FOUND', 'Return not found');
  }
  return decorate(row, Date.now());
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

/** Returned lines with the product behind each one. */
export function returnLines(returnId: string): WarehouseReturnLine[] {
  return db
    .prepare(
      `SELECT ri.id AS returnItemId, ri.order_item_id AS orderItemId, oi.product_id AS productId,
              oi.sku AS sku, oi.product_name AS productName, oi.product_image_url AS imageUrl,
              ri.quantity AS quantity, ri.reason_code AS reasonCode, ri.description AS description
         FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
        WHERE ri.return_id = ? ORDER BY oi.product_name ASC`,
    )
    .all(returnId) as WarehouseReturnLine[];
}

/** Counts driving the dashboard. Derived from live rows, never hardcoded. */
export function queueCounts(warehouseId: string): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT r.status AS status, COUNT(*) AS count FROM returns r
        WHERE r.status NOT IN ('CANCELLED') AND ${siteCondition()} GROUP BY r.status`,
    )
    .all(warehouseId) as Array<{ status: string; count: number }>;
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.status] = row.count;
  }
  return counts;
}

/** Receiving records for the shipments view. */
export function receivingHistory(warehouseId: string, limit: number): ReceivingRecordRow[] {
  return db
    .prepare('SELECT * FROM receiving_records WHERE warehouse_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(warehouseId, limit) as ReceivingRecordRow[];
}
