import { db } from './db.js';
import { createNotification } from './store.js';
import { DEFAULT_WAREHOUSE_ID } from './warehouse/schema.js';
import { createTask } from './warehouse/tasks.js';
import { id, nowIso } from './utils.js';

// ---------------------------------------------------------------------------
// Demo fulfillment scheduler.
//
// Production note: the default stage delays below are intentionally short
// (minutes) so the returns lifecycle is visible in a demo. Production
// deployments should raise them via environment overrides such as
// FULFILL_ORDER_MIN_SHIPPED=1440 or FULFILL_RETURN_MIN_PICKED_UP=2880.
// A setInterval(tickFulfillment, 60_000) driver in server.ts advances at most
// one stage per order/return per tick, using the time the entity entered its
// current stage (order_events.created_at for orders, returns.updated_at for
// returns).
// ---------------------------------------------------------------------------

const ORDER_STAGES = ['PLACED', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const RETURN_STAGES = ['REQUESTED', 'APPROVED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED', 'INSPECTION', 'RESOLVED'];

/**
 * The scheduler simulates the carrier leg only. Once a parcel is IN_TRANSIT it
 * is the warehouse's to receive, inspect and dispose of, so the timer stops
 * here: everything from RECEIVED onward is driven by real operator actions
 * through the warehouse API. Without this boundary the timer would receive and
 * resolve returns before anyone touched them.
 */
const LAST_SCHEDULED_RETURN_STAGE = 'IN_TRANSIT';

/** Customer-facing copy for each stage. The status code stays machine-readable. */
const ORDER_STAGE_COPY: Record<string, string> = {
  CONFIRMED: 'Your order was confirmed.',
  PROCESSING: 'We are preparing your items for dispatch.',
  SHIPPED: 'Your parcel has left our warehouse.',
  IN_TRANSIT: 'Your parcel is on its way.',
  OUT_FOR_DELIVERY: 'Your parcel is out for delivery today.',
  DELIVERED: 'Your parcel was delivered.',
};

const RETURN_STAGE_COPY: Record<string, string> = {
  APPROVED: 'Your return was approved.',
  PICKED_UP: 'Your item was collected by the carrier.',
  IN_TRANSIT: 'Your item is on its way back to us.',
};

const DEFAULT_ORDER_DELAYS: Record<string, number> = {
  CONFIRMED: 1,
  PROCESSING: 2,
  SHIPPED: 3,
  IN_TRANSIT: 5,
  OUT_FOR_DELIVERY: 7,
  DELIVERED: 8,
};

const DEFAULT_RETURN_DELAYS: Record<string, number> = {
  APPROVED: 1,
  PICKED_UP: 2,
  IN_TRANSIT: 3,
};

function envMinutes(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function orderDelayFor(stage: string): number {
  return envMinutes(`FULFILL_ORDER_MIN_${stage}`, DEFAULT_ORDER_DELAYS[stage] ?? 5);
}

function returnDelayFor(stage: string): number {
  return envMinutes(`FULFILL_RETURN_MIN_${stage}`, DEFAULT_RETURN_DELAYS[stage] ?? 5);
}

function minutesSince(isoDate: string | null | undefined): number {
  if (isoDate === null || isoDate === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) {
    return Number.POSITIVE_INFINITY;
  }
  return (Date.now() - then) / 60_000;
}

interface OrderTickRow {
  id: string;
  order_number: string;
  customer_id: string;
  status: string;
}

interface ReturnTickRow {
  id: string;
  return_number: string;
  customer_id: string;
  status: string;
  updated_at: string;
}

function tickOrders(): void {
  const rows = db
    .prepare("SELECT id, order_number, customer_id, status FROM orders WHERE status != 'DELIVERED' AND status != 'CANCELLED'")
    .all() as OrderTickRow[];
  for (const row of rows) {
    const index = ORDER_STAGES.indexOf(row.status);
    if (index < 0 || index >= ORDER_STAGES.length - 1) {
      continue;
    }
    const next = ORDER_STAGES[index + 1] ?? '';
    const lastEvent = db
      .prepare('SELECT created_at FROM order_events WHERE order_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(row.id) as { created_at: string } | undefined;
    const orderBase = db.prepare('SELECT created_at FROM orders WHERE id = ?').get(row.id) as
      | { created_at: string }
      | undefined;
    const enteredAt = lastEvent?.created_at ?? orderBase?.created_at ?? null;
    if (minutesSince(enteredAt) < orderDelayFor(next)) {
      continue;
    }
    const now = nowIso();
    const advance = db.transaction(() => {
      if (next === 'DELIVERED') {
        db.prepare("UPDATE orders SET status = ?, delivered_at = ? WHERE id = ? AND status != 'DELIVERED'").run(next, now, row.id);
      } else {
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(next, row.id);
      }
      db.prepare('INSERT INTO order_events (id, order_id, status, description, created_at) VALUES (?, ?, ?, ?, ?)').run(
        id(), row.id, next, ORDER_STAGE_COPY[next] ?? `Order moved to ${next}`, now,
      );
    });
    advance();
    if (next === 'DELIVERED') {
      createNotification(row.customer_id, {
        type: 'ORDER_DELIVERED',
        title: 'Order delivered',
        body: `Order ${row.order_number} was delivered.`,
      });
    }
  }
}

function tickReturns(): void {
  const rows = db
    .prepare("SELECT id, return_number, customer_id, status, updated_at FROM returns WHERE status != 'RESOLVED' AND status != 'CANCELLED'")
    .all() as ReturnTickRow[];
  const lastScheduled = RETURN_STAGES.indexOf(LAST_SCHEDULED_RETURN_STAGE);
  for (const row of rows) {
    const index = RETURN_STAGES.indexOf(row.status);
    if (index < 0 || index >= lastScheduled) {
      // Already at or past the carrier handover; the warehouse owns it now.
      continue;
    }
    const next = RETURN_STAGES[index + 1] ?? '';
    if (minutesSince(row.updated_at) < returnDelayFor(next)) {
      continue;
    }
    const now = nowIso();
    const advance = db.transaction(() => {
      if (next === 'APPROVED') {
        // Reaching APPROVED is what records the approval stamp the resolution
        // step later requires.
        db.prepare('UPDATE returns SET status = ?, updated_at = ?, approved_at = COALESCE(approved_at, ?) WHERE id = ?').run(
          next, now, now, row.id,
        );
      } else {
        db.prepare('UPDATE returns SET status = ?, updated_at = ? WHERE id = ?').run(next, now, row.id);
      }
      db.prepare('INSERT INTO return_events (id, return_id, status, description, created_at) VALUES (?, ?, ?, ?, ?)').run(
        id(), row.id, next, RETURN_STAGE_COPY[next] ?? `Return moved to ${next}`, now,
      );
      // Pickup status mirrors the return journey for customer visibility.
      const pickup = db.prepare('SELECT id FROM pickups WHERE return_id = ?').get(row.id) as
        | { id: string }
        | undefined;
      if (pickup !== undefined) {
        const pickupStatus = next === 'APPROVED' ? 'SCHEDULED' : next;
        db.prepare('UPDATE pickups SET status = ?, updated_at = ? WHERE return_id = ?').run(pickupStatus, now, row.id);
      }
    });
    advance();

    if (next === 'IN_TRANSIT') {
      // The carrier leg is the last thing the timer does. Hand the parcel to
      // the floor as a real task so it is queued work, not just a row that
      // happens to appear in a list.
      createTask({
        warehouseId: DEFAULT_WAREHOUSE_ID,
        kind: 'RECEIVE_RETURN',
        title: `Receive ${row.return_number}`,
        returnId: row.id,
        priority: 'NORMAL',
      });
    }
  }
}

/** Advance due orders and returns by one stage. Exported for tests. */
export function tickFulfillment(): void {
  tickOrders();
  tickReturns();
}
