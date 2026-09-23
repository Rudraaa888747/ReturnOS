import { db } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { id, nowIso } from '../utils.js';
import { recordAudit } from './audit.js';
import type { InventoryState, MovementReason } from './schema.js';
import type { InventoryBucketRow, InventoryMovementRow } from './types.js';

/**
 * Inventory engine.
 *
 * Two representations of stock exist and must never disagree:
 *
 *   products.stock                     what the storefront sells from
 *   inventory_buckets[state=AVAILABLE] what the warehouse counts as sellable
 *
 * `applyMovement` is the only way either one changes. It writes the bucket
 * change, the mirrored products.stock change, and the ledger row inside a
 * single transaction, so the two cannot drift: either every write lands or
 * none does. Checkout routes its decrement through `consumeAvailableStock`
 * for the same reason — a sale that only touched products.stock would leave
 * the warehouse counting goods that had already shipped.
 *
 * better-sqlite3 is synchronous and nests transactions as SAVEPOINTs, so
 * calling these helpers from inside a larger transaction stays atomic.
 */

/** The sellable state, mirrored into products.stock. */
export const SELLABLE_STATE: InventoryState = 'AVAILABLE';

export interface MovementInput {
  warehouseId: string;
  productId: string;
  quantity: number;
  /** Null when stock enters the warehouse from outside (a customer return). */
  fromState: InventoryState | null;
  /** Null when stock leaves the system entirely (disposal, vendor return). */
  toState: InventoryState | null;
  reason: MovementReason;
  /** Together with reason and product, the replay key. */
  referenceType: string;
  referenceId: string;
  operatorId?: string | null;
  fromLocationId?: string | null;
  toLocationId?: string | null;
}

interface ProductStockRow {
  id: string;
  sku: string;
  stock: number;
}

function loadProduct(productId: string): ProductStockRow {
  const row = db.prepare('SELECT id, sku, stock FROM products WHERE id = ?').get(productId) as
    | ProductStockRow
    | undefined;
  if (row === undefined) {
    throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  }
  return row;
}

/**
 * Take `quantity` out of a bucket, refusing to go negative.
 *
 * The guard lives in the UPDATE's WHERE clause rather than in a read-then-write
 * pair, so two concurrent callers cannot both observe enough stock and both
 * proceed.
 */
function debitBucket(warehouseId: string, productId: string, state: InventoryState, quantity: number, now: string): void {
  const result = db
    .prepare(
      `UPDATE inventory_buckets SET quantity = quantity - ?, updated_at = ?
        WHERE warehouse_id = ? AND product_id = ? AND state = ? AND quantity >= ?`,
    )
    .run(quantity, now, warehouseId, productId, state, quantity);
  if (result.changes === 0) {
    const held = bucketQuantity(warehouseId, productId, state);
    throw new HttpError(
      409,
      'INSUFFICIENT_INVENTORY',
      `Not enough stock in ${state}: ${held} held, ${quantity} requested`,
    );
  }
}

/** Add `quantity` to a bucket, creating it on first use. */
function creditBucket(
  warehouseId: string,
  productId: string,
  state: InventoryState,
  quantity: number,
  locationId: string | null,
  now: string,
): void {
  db.prepare(
    `INSERT INTO inventory_buckets (warehouse_id, product_id, state, quantity, location_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(warehouse_id, product_id, state) DO UPDATE SET
       quantity = quantity + excluded.quantity,
       location_id = COALESCE(excluded.location_id, inventory_buckets.location_id),
       updated_at = excluded.updated_at`,
  ).run(warehouseId, productId, state, quantity, locationId, now);
}

/** Quantity currently held in one bucket. Zero when the bucket does not exist. */
export function bucketQuantity(warehouseId: string, productId: string, state: InventoryState): number {
  const row = db
    .prepare('SELECT quantity FROM inventory_buckets WHERE warehouse_id = ? AND product_id = ? AND state = ?')
    .get(warehouseId, productId, state) as { quantity: number } | undefined;
  return row?.quantity ?? 0;
}

/**
 * Move stock between states and record it.
 *
 * Returns the ledger row, or null when this exact movement was already applied
 * — a replayed request is a no-op rather than a second movement or an error.
 */
export const applyMovement = db.transaction((input: MovementInput): InventoryMovementRow | null => {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new HttpError(400, 'INVALID_QUANTITY', 'Movement quantity must be a positive whole number');
  }
  if (input.fromState === null && input.toState === null) {
    throw new HttpError(400, 'INVALID_MOVEMENT', 'A movement needs a source or a destination');
  }

  // Replay guard. Checked first so a retry never partially re-applies.
  const existing = db
    .prepare(
      `SELECT * FROM inventory_movements
        WHERE reference_type = ? AND reference_id = ? AND reason = ? AND product_id = ?`,
    )
    .get(input.referenceType, input.referenceId, input.reason, input.productId) as
    | InventoryMovementRow
    | undefined;
  if (existing !== undefined) {
    return null;
  }

  const product = loadProduct(input.productId);
  const now = nowIso();

  if (input.fromState !== null) {
    debitBucket(input.warehouseId, input.productId, input.fromState, input.quantity, now);
  }
  if (input.toState !== null) {
    creditBucket(input.warehouseId, input.productId, input.toState, input.quantity, input.toLocationId ?? null, now);
  }

  // Mirror the sellable pool into products.stock in this same transaction.
  if (input.toState === SELLABLE_STATE && input.fromState !== SELLABLE_STATE) {
    db.prepare('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?').run(
      input.quantity,
      now,
      input.productId,
    );
  } else if (input.fromState === SELLABLE_STATE && input.toState !== SELLABLE_STATE) {
    const sold = db
      .prepare('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ? AND stock >= ?')
      .run(input.quantity, now, input.productId, input.quantity);
    if (sold.changes === 0) {
      // The bucket allowed it but products.stock did not: refuse rather than
      // let the two representations diverge.
      throw new HttpError(409, 'INSUFFICIENT_STOCK', `Insufficient sellable stock for ${product.sku}`);
    }
  }

  const movementId = id();
  db.prepare(
    `INSERT INTO inventory_movements (id, warehouse_id, product_id, sku, quantity, from_state, to_state,
      from_location_id, to_location_id, reason, reference_type, reference_id, operator_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    movementId,
    input.warehouseId,
    input.productId,
    product.sku,
    input.quantity,
    input.fromState,
    input.toState,
    input.fromLocationId ?? null,
    input.toLocationId ?? null,
    input.reason,
    input.referenceType,
    input.referenceId,
    input.operatorId ?? null,
    now,
  );

  return db.prepare('SELECT * FROM inventory_movements WHERE id = ?').get(movementId) as InventoryMovementRow;
});

/**
 * Remove sold units from the sellable pool.
 *
 * Checkout calls this instead of updating products.stock directly, so a sale
 * decrements the AVAILABLE bucket and products.stock together. Returns false
 * when there is not enough stock, letting checkout raise its own error.
 */
export const consumeAvailableStock = db.transaction(
  (input: { warehouseId: string; productId: string; quantity: number; orderId: string }): boolean => {
    const now = nowIso();
    const sold = db
      .prepare('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ? AND stock >= ?')
      .run(input.quantity, now, input.productId, input.quantity);
    if (sold.changes === 0) {
      return false;
    }

    // Keep the bucket in step. It can legitimately be short if stock was loaded
    // outside the warehouse, so clamp instead of failing the sale: products.stock
    // stays authoritative for selling and the ledger still records the movement.
    //
    // A clamp means the two representations were already out of step, so it is
    // recorded rather than swallowed. A silent clamp would let real drift sit
    // undetected; this surfaces it in the audit trail and on the dashboard.
    const held = bucketQuantity(input.warehouseId, input.productId, SELLABLE_STATE);
    const fromBucket = Math.min(held, input.quantity);
    if (fromBucket < input.quantity) {
      recordAudit({
        actorId: null,
        actorRole: 'SYSTEM',
        warehouseId: input.warehouseId,
        action: 'WARNING_INVENTORY_CLAMPED',
        entityType: 'PRODUCT',
        entityId: input.productId,
        previousState: String(held),
        newState: String(Math.max(0, held - fromBucket)),
        metadata: {
          reason: 'AVAILABLE bucket held fewer units than the sale required',
          requested: input.quantity,
          bucketHeld: held,
          shortfall: input.quantity - fromBucket,
          orderId: input.orderId,
        },
      });
    }
    if (fromBucket > 0) {
      db.prepare(
        `UPDATE inventory_buckets SET quantity = quantity - ?, updated_at = ?
          WHERE warehouse_id = ? AND product_id = ? AND state = ?`,
      ).run(fromBucket, now, input.warehouseId, input.productId, SELLABLE_STATE);
    }

    db.prepare(
      `INSERT OR IGNORE INTO inventory_movements (id, warehouse_id, product_id, sku, quantity, from_state, to_state,
        from_location_id, to_location_id, reason, reference_type, reference_id, operator_id, created_at)
       SELECT ?, ?, id, sku, ?, ?, NULL, NULL, NULL, 'ADJUSTMENT', 'ORDER', ?, NULL, ?
         FROM products WHERE id = ?`,
    ).run(id(), input.warehouseId, input.quantity, SELLABLE_STATE, input.orderId, now, input.productId);

    return true;
  },
);

/**
 * Align the AVAILABLE buckets with products.stock.
 *
 * Used at seed time to establish the starting position for catalogue stock
 * that was loaded before the warehouse existed. It is not part of normal
 * operation: after this, the two move together through applyMovement.
 */
export const syncAvailableBuckets = db.transaction((warehouseId: string): void => {
  const now = nowIso();
  db.prepare(
    `INSERT INTO inventory_buckets (warehouse_id, product_id, state, quantity, location_id, updated_at)
     SELECT ?, id, ?, stock, NULL, ? FROM products
     WHERE TRUE
     ON CONFLICT(warehouse_id, product_id, state) DO UPDATE SET
       quantity = excluded.quantity,
       updated_at = excluded.updated_at`,
  ).run(warehouseId, SELLABLE_STATE, now);
});

export interface InventoryLine {
  productId: string;
  sku: string;
  name: string;
  imageUrl: string | null;
  states: Record<string, number>;
  sellableStock: number;
}

/** Per-product quantities across every state, for the inventory screen. */
export function listInventory(warehouseId: string): InventoryLine[] {
  const products = db
    .prepare('SELECT id, sku, name, image_url, stock FROM products ORDER BY name ASC')
    .all() as Array<{ id: string; sku: string; name: string; image_url: string; stock: number }>;
  const buckets = db
    .prepare('SELECT product_id, state, quantity FROM inventory_buckets WHERE warehouse_id = ?')
    .all(warehouseId) as Array<{ product_id: string; state: string; quantity: number }>;

  const byProduct = new Map<string, Record<string, number>>();
  for (const bucket of buckets) {
    const states = byProduct.get(bucket.product_id) ?? {};
    states[bucket.state] = bucket.quantity;
    byProduct.set(bucket.product_id, states);
  }

  return products.map((product) => ({
    productId: product.id,
    sku: product.sku,
    name: product.name,
    imageUrl: product.image_url === '' ? null : product.image_url,
    states: byProduct.get(product.id) ?? {},
    sellableStock: product.stock,
  }));
}

export interface MovementQuery {
  warehouseId: string;
  productId?: string;
  reason?: MovementReason;
  limit: number;
  offset: number;
}

/** Movement history, newest first. */
export function listMovements(query: MovementQuery): { movements: InventoryMovementRow[]; total: number } {
  const filters = ['warehouse_id = ?'];
  const params: unknown[] = [query.warehouseId];
  if (query.productId !== undefined) {
    filters.push('product_id = ?');
    params.push(query.productId);
  }
  if (query.reason !== undefined) {
    filters.push('reason = ?');
    params.push(query.reason);
  }
  const where = filters.join(' AND ');
  const total = (
    db.prepare(`SELECT COUNT(*) AS count FROM inventory_movements WHERE ${where}`).get(...params) as { count: number }
  ).count;
  const movements = db
    .prepare(`SELECT * FROM inventory_movements WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, query.limit, query.offset) as InventoryMovementRow[];
  return { movements, total };
}

/** Buckets for one product, for detail views and tests. */
export function bucketsFor(warehouseId: string, productId: string): InventoryBucketRow[] {
  return db
    .prepare('SELECT * FROM inventory_buckets WHERE warehouse_id = ? AND product_id = ? ORDER BY state ASC')
    .all(warehouseId, productId) as InventoryBucketRow[];
}
