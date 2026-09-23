/**
 * Maintenance script: reset the local demo database to its seeded baseline.
 *
 * Clears the throwaway orders that accumulate during development and
 * end-to-end runs, restores catalogue stock, and puts the seeded demo return
 * back under inspection so the demo tells the same story on every run.
 *
 * Only touches the local SQLite development database. Everything tied to a
 * removed order (items, events, returns and their children, refunds, credit
 * ledger rows, idempotency keys) is removed with it, so no dangling rows or
 * store-credit balances survive.
 *
 *   npm run trim:orders
 */
import { db, initSchema } from '../src/db.js';
import { CATALOG, seedDatabase } from '../src/seed.js';

/** The orders the seed script creates; everything else is development residue. */
const KEEP_ORDER_IDS = ['o-2026-1001', 'o-2026-1002', 'o-2026-1003'];

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(',');
}

initSchema();

const trim = db.transaction(() => {
  const keepList = placeholders(KEEP_ORDER_IDS);
  const doomedOrders = db
    .prepare(`SELECT id FROM orders WHERE id NOT IN (${keepList})`)
    .all(...KEEP_ORDER_IDS) as Array<{ id: string }>;
  const orderIds = doomedOrders.map((row) => row.id);

  if (orderIds.length === 0) {
    return { orders: 0, returns: 0 };
  }
  const orderList = placeholders(orderIds);

  const doomedReturns = db
    .prepare(`SELECT id FROM returns WHERE order_id IN (${orderList})`)
    .all(...orderIds) as Array<{ id: string }>;
  const returnIds = doomedReturns.map((row) => row.id);

  if (returnIds.length > 0) {
    const returnList = placeholders(returnIds);
    for (const table of ['return_items', 'return_events', 'pickups', 'refunds', 'documents', 'feedback', 'notifications']) {
      db.prepare(`DELETE FROM ${table} WHERE return_id IN (${returnList})`).run(...returnIds);
    }
    db.prepare(
      `DELETE FROM store_credit_ledger WHERE reference_type = 'RETURN' AND reference_id IN (${returnList})`,
    ).run(...returnIds);
    db.prepare(`UPDATE support_tickets SET return_id = NULL WHERE return_id IN (${returnList})`).run(...returnIds);
    db.prepare(`UPDATE orders SET source_return_id = NULL WHERE source_return_id IN (${returnList})`).run(...returnIds);
    db.prepare(`DELETE FROM returns WHERE id IN (${returnList})`).run(...returnIds);
  }

  db.prepare(
    `DELETE FROM store_credit_ledger WHERE reference_type = 'ORDER' AND reference_id IN (${orderList})`,
  ).run(...orderIds);
  db.prepare(`DELETE FROM idempotency_keys WHERE order_id IN (${orderList})`).run(...orderIds);
  db.prepare(`DELETE FROM order_events WHERE order_id IN (${orderList})`).run(...orderIds);
  db.prepare(`DELETE FROM order_items WHERE order_id IN (${orderList})`).run(...orderIds);
  db.prepare(`DELETE FROM orders WHERE id IN (${orderList})`).run(...orderIds);

  // Restart the ORD-YYYY-NNNN series now that the development orders are gone.
  db.prepare('UPDATE order_counter SET last_seq = 0').run();

  return { orders: orderIds.length, returns: returnIds.length };
});

const removed = trim();

/**
 * Restore catalogue stock. Development checkouts decrement it for real, so a
 * reset that removes those orders must give the inventory back.
 */
const restock = db.transaction(() => {
  const update = db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?');
  const now = new Date().toISOString();
  for (const entry of CATALOG) {
    update.run(entry.stock, now, entry.id);
  }
});
restock();

/**
 * Put the seeded return back where the demo expects it: under inspection with
 * a refund still pending, rather than wherever the fulfillment scheduler left
 * it during earlier runs.
 */
const resetSeededReturn = db.transaction(() => {
  const seeded = db.prepare("SELECT id FROM returns WHERE id = 'r-2026-0841'").get() as { id: string } | undefined;
  if (seeded === undefined) {
    return;
  }
  const inspectedAt = new Date(Date.now() - 86_400_000).toISOString();
  db.prepare("UPDATE returns SET status = 'INSPECTION', updated_at = ? WHERE id = ?").run(inspectedAt, seeded.id);
  db.prepare("DELETE FROM return_events WHERE return_id = ? AND status NOT IN ('REQUESTED', 'APPROVED', 'INSPECTION')").run(
    seeded.id,
  );
  db.prepare("DELETE FROM store_credit_ledger WHERE reference_type = 'RETURN' AND reference_id = ?").run(seeded.id);
  db.prepare(
    "UPDATE refunds SET status = 'PENDING', initiated_at = ?, completed_at = NULL WHERE return_id = ?",
  ).run(inspectedAt, seeded.id);
});
resetSeededReturn();

// Re-run the seed so catalogue pricing and the demo orders line up again.
seedDatabase();

const remaining = db.prepare('SELECT order_number, status FROM orders ORDER BY created_at DESC').all() as Array<{
  order_number: string;
  status: string;
}>;
const violations = db.prepare('PRAGMA foreign_key_check').all();

process.stdout.write(`Removed ${removed.orders} order(s) and ${removed.returns} return(s).\n`);
process.stdout.write(`Remaining orders (${remaining.length}):\n`);
for (const row of remaining) {
  process.stdout.write(`  ${row.order_number} ${row.status}\n`);
}
process.stdout.write(`Foreign key violations: ${violations.length}\n`);
