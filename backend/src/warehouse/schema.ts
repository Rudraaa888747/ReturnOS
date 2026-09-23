import { db } from '../db.js';

/**
 * Warehouse operations schema.
 *
 * Kept in its own module so the customer schema in db.ts stays readable, but
 * it runs inside the same initSchema() pass against the same connection.
 *
 * Design notes:
 *  - Nothing here duplicates an existing entity. Returns, orders, products,
 *    refunds, the store-credit ledger and `pickups` (the inbound shipment
 *    record) stay authoritative; these tables reference them.
 *  - Every operational table carries `warehouse_id` from day one. The system
 *    seeds and runs a single warehouse today, so going multi-warehouse is a
 *    data and authorization change rather than a schema rewrite.
 *  - Duplicate work is prevented by UNIQUE constraints rather than by
 *    application checks alone, so a retried request cannot double-apply.
 */

// ---------------------------------------------------------------------------
// Controlled vocabularies. Exported so routes, services and tests share one
// definition, and mirrored as CHECK constraints so the database enforces them.
// ---------------------------------------------------------------------------

export const USER_ROLES = ['CUSTOMER', 'WAREHOUSE'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Physical areas inside a warehouse. Each inventory state maps to one kind. */
export const LOCATION_KINDS = [
  'RECEIVING',
  'INSPECTION',
  'STOCK',
  'DAMAGED',
  'REPAIR',
  'RESALE',
  'VENDOR_RETURN',
  'RECYCLE',
  'DISPOSAL',
] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

/** Condition recorded when a parcel is physically received. */
export const PACKAGE_CONDITIONS = ['SEALED', 'OPENED', 'DAMAGED'] as const;
export type PackageCondition = (typeof PACKAGE_CONDITIONS)[number];

/** Discrepancies a receiver can record instead of silently accepting a parcel. */
export const RECEIVING_DISCREPANCIES = [
  'NONE',
  'WRONG_ITEM',
  'QUANTITY_MISMATCH',
  'DAMAGED_PACKAGE',
  'MISSING_ITEM',
] as const;
export type ReceivingDiscrepancy = (typeof RECEIVING_DISCREPANCIES)[number];

/** Outcome of inspecting a returned line. Drives which dispositions are legal. */
export const INSPECTION_RESULTS = [
  'PASS',
  'DAMAGED',
  'DEFECTIVE',
  'INCOMPLETE',
  'WRONG_ITEM',
  'UNSELLABLE',
] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];

export const CONDITION_GRADES = ['NEW', 'LIKE_NEW', 'USED', 'DAMAGED', 'UNUSABLE'] as const;
export type ConditionGrade = (typeof CONDITION_GRADES)[number];

/** What physically happens to the goods after inspection. */
export const DISPOSITION_ACTIONS = [
  'RESTOCK',
  'RESELL',
  'REPAIR',
  'RETURN_TO_VENDOR',
  'RECYCLE',
  'DISPOSE',
] as const;
export type DispositionAction = (typeof DISPOSITION_ACTIONS)[number];

/**
 * Operational inventory states. `AVAILABLE` is the sellable pool and is kept in
 * step with `products.stock`, which the storefront reads; the other states hold
 * stock that exists physically but cannot be sold.
 */
export const INVENTORY_STATES = [
  'AVAILABLE',
  'RETURNED',
  'INSPECTION',
  'DAMAGED',
  'REPAIR',
  'RESALE',
  'VENDOR_RETURN',
  'RECYCLE',
  'DISPOSAL',
  'RESERVED',
] as const;
export type InventoryState = (typeof INVENTORY_STATES)[number];

/** Why stock moved. Every movement row carries one. */
export const MOVEMENT_REASONS = [
  'RETURN_RECEIVED',
  'INSPECTION_STARTED',
  'INSPECTION_COMPLETED',
  'RESTOCK',
  'DAMAGE',
  'REPAIR',
  'RESALE',
  'VENDOR_RETURN',
  'RECYCLE',
  'DISPOSAL',
  'ADJUSTMENT',
] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

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
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Hours allowed per task kind before it counts as overdue. */
export const TASK_SLA_HOURS: Record<TaskKind, number> = {
  RECEIVE_RETURN: 24,
  INSPECT_ITEM: 24,
  PROCESS_DISPOSITION: 48,
  // A held payout is a customer waiting on money: the tightest window here.
  REVIEW_APPROVAL: 8,
  RESTOCK: 24,
  PACKAGE_REPLACEMENT: 48,
  PREPARE_EXCHANGE: 48,
  VERIFY_SHIPMENT: 12,
};

/** Which dispositions the backend will accept for each inspection result. */
export const ALLOWED_DISPOSITIONS: Record<InspectionResult, readonly DispositionAction[]> = {
  // Sellable again, so restocking is legal; reselling covers open-box channels.
  PASS: ['RESTOCK', 'RESELL'],
  DAMAGED: ['REPAIR', 'RETURN_TO_VENDOR', 'RECYCLE', 'DISPOSE'],
  DEFECTIVE: ['REPAIR', 'RETURN_TO_VENDOR', 'RECYCLE', 'DISPOSE'],
  INCOMPLETE: ['REPAIR', 'RESELL', 'RETURN_TO_VENDOR', 'DISPOSE'],
  // Not ours to restock: it goes back to the vendor it came from.
  WRONG_ITEM: ['RETURN_TO_VENDOR', 'RESELL'],
  UNSELLABLE: ['RECYCLE', 'DISPOSE', 'RETURN_TO_VENDOR'],
};

/** Inventory state each disposition action moves goods into. */
export const DISPOSITION_TARGET_STATE: Record<DispositionAction, InventoryState> = {
  RESTOCK: 'AVAILABLE',
  RESELL: 'RESALE',
  REPAIR: 'REPAIR',
  RETURN_TO_VENDOR: 'VENDOR_RETURN',
  RECYCLE: 'RECYCLE',
  DISPOSE: 'DISPOSAL',
};

export const DISPOSITION_MOVEMENT_REASON: Record<DispositionAction, MovementReason> = {
  RESTOCK: 'RESTOCK',
  RESELL: 'RESALE',
  REPAIR: 'REPAIR',
  RETURN_TO_VENDOR: 'VENDOR_RETURN',
  RECYCLE: 'RECYCLE',
  DISPOSE: 'DISPOSAL',
};

/** The one warehouse the system currently operates. */
export const DEFAULT_WAREHOUSE_ID = 'wh-blr-01';

function list(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

/** Create the warehouse tables, indexes and seed rows. Safe to re-run. */
export function initWarehouseSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS warehouses (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS warehouse_locations (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN (${list(LOCATION_KINDS)})),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL,
      UNIQUE (warehouse_id, code)
    );

    /* One receiving record per return: the UNIQUE constraint is what makes a
       repeated receive request a conflict rather than a duplicate parcel. */
    CREATE TABLE IF NOT EXISTS receiving_records (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL UNIQUE REFERENCES returns(id) ON DELETE CASCADE,
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      location_id TEXT NULL REFERENCES warehouse_locations(id),
      received_by TEXT NOT NULL REFERENCES users(id),
      tracking_number TEXT NULL,
      carrier TEXT NULL,
      package_condition TEXT NOT NULL CHECK (package_condition IN (${list(PACKAGE_CONDITIONS)})),
      discrepancy TEXT NOT NULL DEFAULT 'NONE' CHECK (discrepancy IN (${list(RECEIVING_DISCREPANCIES)})),
      expected_quantity INTEGER NOT NULL CHECK (expected_quantity >= 0),
      received_quantity INTEGER NOT NULL CHECK (received_quantity >= 0),
      notes TEXT NULL,
      created_at TEXT NOT NULL
    );

    /* Inspection header. One per return; per-line findings live in
       inspection_items so a multi-line return can be graded item by item. */
    CREATE TABLE IF NOT EXISTS inspections (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL UNIQUE REFERENCES returns(id) ON DELETE CASCADE,
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      inspected_by TEXT NOT NULL REFERENCES users(id),
      result TEXT NULL CHECK (result IS NULL OR result IN (${list(INSPECTION_RESULTS)})),
      notes TEXT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS inspection_items (
      id TEXT PRIMARY KEY,
      inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
      return_item_id TEXT NOT NULL REFERENCES return_items(id) ON DELETE CASCADE,
      result TEXT NOT NULL CHECK (result IN (${list(INSPECTION_RESULTS)})),
      product_condition TEXT NOT NULL CHECK (product_condition IN (${list(CONDITION_GRADES)})),
      packaging_condition TEXT NOT NULL CHECK (packaging_condition IN (${list(CONDITION_GRADES)})),
      missing_components TEXT NULL,
      damage_notes TEXT NULL,
      serial_number TEXT NULL,
      quantity INTEGER NOT NULL CHECK (quantity >= 1),
      created_at TEXT NOT NULL,
      UNIQUE (inspection_id, return_item_id)
    );

    /* One disposition per returned line. UNIQUE(return_item_id) stops the same
       goods being restocked and scrapped, or counted twice. */
    CREATE TABLE IF NOT EXISTS dispositions (
      id TEXT PRIMARY KEY,
      return_item_id TEXT NOT NULL UNIQUE REFERENCES return_items(id) ON DELETE CASCADE,
      return_id TEXT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
      inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      location_id TEXT NULL REFERENCES warehouse_locations(id),
      action TEXT NOT NULL CHECK (action IN (${list(DISPOSITION_ACTIONS)})),
      quantity INTEGER NOT NULL CHECK (quantity >= 1),
      reason TEXT NULL,
      notes TEXT NULL,
      recovery_value_paise INTEGER NOT NULL DEFAULT 0 CHECK (recovery_value_paise >= 0),
      operator_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    /* Quantity held per product per operational state. AVAILABLE mirrors
       products.stock, which the storefront sells from. */
    CREATE TABLE IF NOT EXISTS inventory_buckets (
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      state TEXT NOT NULL CHECK (state IN (${list(INVENTORY_STATES)})),
      quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
      location_id TEXT NULL REFERENCES warehouse_locations(id),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (warehouse_id, product_id, state)
    );

    /* Append-only stock ledger. The UNIQUE reference makes a replayed
       operation a no-op instead of a second movement. */
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      sku TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      from_state TEXT NULL CHECK (from_state IS NULL OR from_state IN (${list(INVENTORY_STATES)})),
      to_state TEXT NULL CHECK (to_state IS NULL OR to_state IN (${list(INVENTORY_STATES)})),
      from_location_id TEXT NULL REFERENCES warehouse_locations(id),
      to_location_id TEXT NULL REFERENCES warehouse_locations(id),
      reason TEXT NOT NULL CHECK (reason IN (${list(MOVEMENT_REASONS)})),
      reference_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      operator_id TEXT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS warehouse_tasks (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN (${list(TASK_KINDS)})),
      title TEXT NOT NULL,
      return_id TEXT NULL REFERENCES returns(id) ON DELETE CASCADE,
      order_id TEXT NULL REFERENCES orders(id) ON DELETE CASCADE,
      priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN (${list(TASK_PRIORITIES)})),
      status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN (${list(TASK_STATUSES)})),
      assigned_to TEXT NULL REFERENCES users(id),
      blocked_reason TEXT NULL,
      created_at TEXT NOT NULL,
      due_at TEXT NOT NULL,
      started_at TEXT NULL,
      completed_at TEXT NULL
    );

    /* Append-only. No route updates or deletes these rows. */
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      actor_id TEXT NULL REFERENCES users(id),
      actor_role TEXT NOT NULL,
      warehouse_id TEXT NULL REFERENCES warehouses(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      previous_state TEXT NULL,
      new_state TEXT NULL,
      metadata TEXT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_wh_locations_wh ON warehouse_locations(warehouse_id, kind);
    CREATE INDEX IF NOT EXISTS idx_receiving_wh ON receiving_records(warehouse_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_inspections_wh ON inspections(warehouse_id, completed_at);
    CREATE INDEX IF NOT EXISTS idx_dispositions_wh ON dispositions(warehouse_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_dispositions_return ON dispositions(return_id);
    /* Replay guard: one movement per source event per product. product_id is
       part of the key because a single order moves several products at once. */
    CREATE UNIQUE INDEX IF NOT EXISTS idx_movements_dedupe
      ON inventory_movements(reference_type, reference_id, reason, product_id);
    CREATE INDEX IF NOT EXISTS idx_movements_wh_created ON inventory_movements(warehouse_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_movements_product ON inventory_movements(product_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_wh_status ON warehouse_tasks(warehouse_id, status, due_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON warehouse_tasks(assigned_to, status);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, created_at);

    /* At most one open task of a kind per return, so requeueing is idempotent. */
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_unique_open_return
      ON warehouse_tasks(kind, return_id)
      WHERE return_id IS NOT NULL AND status IN ('TODO', 'IN_PROGRESS');
  `);

  // A dev database created during Phase 1 carries a table-level UNIQUE that
  // omitted product_id. The table is an append-only ledger with no data yet at
  // that point, so rebuilding it is safe and keeps dev databases consistent.
  const movementSql = (
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'inventory_movements'").get() as
      | { sql: string }
      | undefined
  )?.sql;
  if (movementSql !== undefined && movementSql.includes('UNIQUE (reference_type, reference_id, reason)')) {
    const rows = db.prepare('SELECT COUNT(*) AS count FROM inventory_movements').get() as { count: number };
    if (rows.count === 0) {
      db.exec('DROP TABLE inventory_movements');
      initWarehouseSchema();
      return;
    }
  }

  // Tasks record the moment an SLA breach was first observed, so the warning
  // is raised once rather than re-reported on every dashboard load.
  const taskColumns = new Set(
    (db.prepare('PRAGMA table_info(warehouse_tasks)').all() as Array<{ name: string }>).map((col) => col.name),
  );
  if (!taskColumns.has('sla_breached_at')) {
    db.exec('ALTER TABLE warehouse_tasks ADD COLUMN sla_breached_at TEXT NULL');
  }

  // Returns gain an explicit approval stamp. Receiving a parcel proves it
  // arrived, not that the claim was accepted, so approval is tracked
  // separately from status and is required before any financial outcome.
  const returnColumns = new Set(
    (db.prepare('PRAGMA table_info(returns)').all() as Array<{ name: string }>).map((col) => col.name),
  );
  if (!returnColumns.has('approved_at')) {
    db.exec('ALTER TABLE returns ADD COLUMN approved_at TEXT NULL');
  }
  if (!returnColumns.has('approved_by')) {
    db.exec('ALTER TABLE returns ADD COLUMN approved_by TEXT NULL REFERENCES users(id)');
  }
  // Returns that already carry an APPROVED event were approved before this
  // column existed; stamp them so history stays truthful.
  db.exec(`
    UPDATE returns SET approved_at = (
      SELECT MIN(created_at) FROM return_events e
       WHERE e.return_id = returns.id AND e.status = 'APPROVED'
    )
    WHERE approved_at IS NULL
      AND EXISTS (SELECT 1 FROM return_events e WHERE e.return_id = returns.id AND e.status = 'APPROVED');
  `);

  // users gains a warehouse scope. Customers keep NULL; a warehouse operator is
  // pinned to exactly one site, which is what authorization filters on.
  const userColumns = new Set(
    (db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map((col) => col.name),
  );
  if (!userColumns.has('warehouse_id')) {
    db.exec('ALTER TABLE users ADD COLUMN warehouse_id TEXT NULL REFERENCES warehouses(id)');
  }

  // pickups is already the inbound shipment record; it only lacked the two
  // fields the receiving desk needs.
  const pickupColumns = new Set(
    (db.prepare('PRAGMA table_info(pickups)').all() as Array<{ name: string }>).map((col) => col.name),
  );
  if (!pickupColumns.has('expected_arrival')) {
    db.exec('ALTER TABLE pickups ADD COLUMN expected_arrival TEXT NULL');
  }
  if (!pickupColumns.has('received_at')) {
    db.exec('ALTER TABLE pickups ADD COLUMN received_at TEXT NULL');
  }

  seedWarehouse();
}

const LOCATION_SEED: Array<{ code: string; name: string; kind: LocationKind }> = [
  { code: 'RCV-01', name: 'Receiving dock', kind: 'RECEIVING' },
  { code: 'INS-01', name: 'Inspection bench', kind: 'INSPECTION' },
  { code: 'STK-A1', name: 'Sellable stock A1', kind: 'STOCK' },
  { code: 'DMG-01', name: 'Damaged goods cage', kind: 'DAMAGED' },
  { code: 'REP-01', name: 'Repair bench', kind: 'REPAIR' },
  { code: 'RSL-01', name: 'Open-box resale shelf', kind: 'RESALE' },
  { code: 'VND-01', name: 'Vendor return pallet', kind: 'VENDOR_RETURN' },
  { code: 'RCY-01', name: 'Recycling bin', kind: 'RECYCLE' },
  { code: 'DSP-01', name: 'Disposal bin', kind: 'DISPOSAL' },
];

/** Seed the single operating warehouse and its locations. Idempotent. */
function seedWarehouse(): void {
  const now = new Date().toISOString();
  const run = db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO warehouses (id, code, name, city, active, created_at, updated_at)
       VALUES (?, 'BLR-01', 'Bengaluru Returns Hub', 'Bengaluru', 1, ?, ?)`,
    ).run(DEFAULT_WAREHOUSE_ID, now, now);

    const insertLocation = db.prepare(
      `INSERT OR IGNORE INTO warehouse_locations (id, warehouse_id, code, name, kind, active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    );
    for (const location of LOCATION_SEED) {
      insertLocation.run(
        `loc-${DEFAULT_WAREHOUSE_ID}-${location.code.toLowerCase()}`,
        DEFAULT_WAREHOUSE_ID,
        location.code,
        location.name,
        location.kind,
        now,
      );
    }
  });
  run();
}
