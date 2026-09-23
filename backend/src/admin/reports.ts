import { listInventoryAdmin, listMovementsAdmin, listOrdersAdmin, listReturnsAdmin } from './readers.js';
import { listRefundsAdmin } from './finance.js';
import { listLedgerAdmin } from './finance.js';

/**
 * Exportable CSV reports built on the same authorized readers the JSON
 * endpoints serve — never a second data path. Capped row counts keep an
 * export from becoming a database dump.
 */

export const REPORT_ROW_CAP = 10000;

/** Escape one CSV cell, including formula-injection hardening. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

export interface ReportFilters {
  search?: string;
  status?: string;
  limit?: number;
}

function cap(limit?: number): number {
  if (limit === undefined) return REPORT_ROW_CAP;
  if (!Number.isInteger(limit) || limit < 1) return REPORT_ROW_CAP;
  return Math.min(limit, REPORT_ROW_CAP);
}

export function ordersReport(filters: ReportFilters): string {
  const { orders } = listOrdersAdmin({
    search: filters.search,
    status: filters.status,
    sort: 'created_at',
    dir: 'DESC',
    limit: cap(filters.limit),
    offset: 0,
  });
  return toCsv(
    ['order_number', 'customer_email', 'customer_name', 'items', 'subtotal_paise', 'payment_status', 'status', 'carrier', 'tracking_number', 'created_at'],
    orders.map((row) => [
      row.order_number, row.customer_email, row.customer_name, row.items_count,
      row.subtotal_paise, row.payment_status, row.status, row.carrier, row.tracking_number, row.created_at,
    ]),
  );
}

export function returnsReport(filters: ReportFilters & { resolution?: string }): string {
  const { returns } = listReturnsAdmin({
    search: filters.search,
    status: filters.status,
    resolution: filters.resolution,
    sort: 'created_at',
    dir: 'DESC',
    limit: cap(filters.limit),
    offset: 0,
  });
  return toCsv(
    ['return_number', 'order_number', 'customer_email', 'product_name', 'sku', 'quantity', 'reason_code', 'status', 'resolution_type', 'created_at'],
    returns.map((row) => [
      row.return_number, row.order_number, row.customer_email, row.product_name, row.sku,
      row.quantity, row.reason_code, row.status, row.resolution_type, row.created_at,
    ]),
  );
}

export function refundsReport(filters: ReportFilters & { kind?: string }): string {
  const { refunds } = listRefundsAdmin({
    search: filters.search,
    status: filters.status,
    kind: filters.kind,
    limit: cap(filters.limit),
    offset: 0,
  });
  return toCsv(
    ['id', 'return_number', 'order_number', 'customer_email', 'kind', 'amount_paise', 'method', 'status', 'initiated_at', 'completed_at'],
    refunds.map((row) => [
      row.id, row.return_number, row.order_number, row.customer_email, row.kind,
      row.amount_paise, row.method, row.status, row.initiated_at, row.completed_at,
    ]),
  );
}

export function creditReport(filters: { userId?: string; type?: string; limit?: number }): string {
  const { entries } = listLedgerAdmin({
    userId: filters.userId,
    type: filters.type,
    limit: cap(filters.limit),
    offset: 0,
  });
  return toCsv(
    ['id', 'user_email', 'type', 'amount_paise', 'reason', 'reference_type', 'reference_id', 'created_at'],
    entries.map((row) => [
      row.id, row.user_email, row.type, row.amount_paise, row.reason,
      row.reference_type, row.reference_id, row.created_at,
    ]),
  );
}

export function inventoryReport(filters: ReportFilters): string {
  const { inventory } = listInventoryAdmin({
    search: filters.search,
    limit: cap(filters.limit),
    offset: 0,
  });
  const rows: unknown[][] = [];
  for (const line of inventory) {
    if (line.buckets.length === 0) {
      rows.push([line.sku, line.name, '', '', line.sellable_stock]);
    }
    for (const bucket of line.buckets) {
      rows.push([line.sku, line.name, bucket.warehouse_id, bucket.state, bucket.quantity]);
    }
  }
  return toCsv(['sku', 'product', 'warehouse_id', 'state', 'quantity'], rows);
}

export function movementsReport(filters: { warehouseId?: string; productId?: string; reason?: string; limit?: number }): string {
  const { movements } = listMovementsAdmin({
    warehouseId: filters.warehouseId,
    productId: filters.productId,
    reason: filters.reason,
    limit: cap(filters.limit),
    offset: 0,
  });
  return toCsv(
    ['id', 'warehouse_id', 'sku', 'quantity', 'from_state', 'to_state', 'reason', 'reference_type', 'reference_id', 'created_at'],
    movements.map((row) => [
      row.id, row.warehouse_id, row.sku, row.quantity, row.from_state, row.to_state,
      row.reason, row.reference_type, row.reference_id, row.created_at,
    ]),
  );
}
