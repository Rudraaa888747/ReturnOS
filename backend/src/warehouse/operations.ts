import { db } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { createNotification, insertReturnEvent, resolveReturnAtResolved } from '../store.js';
import type { ReturnItemRow, ReturnRow } from '../store.js';
import { id, nowIso } from '../utils.js';
import { recordAudit } from './audit.js';
import { applyMovement } from './inventory.js';
import { completeTasksFor, createTask, startTasksFor } from './tasks.js';
import {
  ALLOWED_DISPOSITIONS,
  DISPOSITION_MOVEMENT_REASON,
  DISPOSITION_TARGET_STATE,
} from './schema.js';
import type { ConditionGrade, DispositionAction, InspectionResult, PackageCondition, ReceivingDiscrepancy } from './schema.js';
import type { DispositionRow, InspectionItemRow, InspectionRow, ReceivingRecordRow } from './types.js';

/**
 * Warehouse operations: receiving, inspection and disposition.
 *
 * Two rules shape this module.
 *
 * 1. The return lifecycle is a forward-only sequence. A return cannot be
 *    inspected before it is received, or disposed before it is inspected, and
 *    none of it can happen twice. The guards below reject out-of-order work,
 *    and the UNIQUE constraints in the schema make duplicates impossible even
 *    if two requests arrive at once.
 *
 * 2. Financial outcomes are not decided here. When the last line of a return
 *    has been disposed, this module calls `resolveReturnAtResolved` in
 *    store.ts — the existing engine that issues store credit, completes
 *    refunds, and creates replacement or exchange orders. Reimplementing any
 *    of that would give the warehouse a second, divergent source of truth.
 */

interface Operator {
  id: string;
  role: string;
  warehouseId: string;
}

/** Load a return, or fail with the same 404 the customer API uses. */
function loadReturn(returnId: string): ReturnRow {
  const row = db.prepare('SELECT * FROM returns WHERE id = ?').get(returnId) as ReturnRow | undefined;
  if (row === undefined) {
    throw new HttpError(404, 'RETURN_NOT_FOUND', 'Return not found');
  }
  return row;
}

/** The dock holding the parcel, once one has received it. Null before that. */
function receivingSite(returnId: string): string | null {
  const row = db.prepare('SELECT warehouse_id FROM receiving_records WHERE return_id = ?').get(returnId) as
    | { warehouse_id: string }
    | undefined;
  return row?.warehouse_id ?? null;
}

/**
 * Pin received work to its dock. Before the first receipt a return is an
 * arrival any site may work (receive/approve); after that, only the holding
 * site may see or touch it. Foreign ids 404 exactly like missing ones, so
 * another dock's queue cannot be probed.
 */
function assertReturnSite(operator: Operator, returnId: string): void {
  const site = receivingSite(returnId);
  if (site !== null && site !== operator.warehouseId) {
    throw new HttpError(404, 'RETURN_NOT_FOUND', 'Return not found');
  }
}

function returnItems(returnId: string): ReturnItemRow[] {
  return db.prepare('SELECT * FROM return_items WHERE return_id = ?').all(returnId) as ReturnItemRow[];
}

/** The product and SKU behind a returned line, via the order item it came from. */
function lineProduct(returnItemId: string): { productId: string; sku: string; productName: string } {
  const row = db
    .prepare(
      `SELECT oi.product_id AS productId, oi.sku AS sku, oi.product_name AS productName
         FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
        WHERE ri.id = ?`,
    )
    .get(returnItemId) as { productId: string; sku: string; productName: string } | undefined;
  if (row === undefined) {
    throw new HttpError(404, 'RETURN_ITEM_NOT_FOUND', 'Return item not found');
  }
  return row;
}

/**
 * Statuses a parcel can be received from.
 *
 * Every pre-receipt stage qualifies, including REQUESTED: physical arrival is
 * ground truth, and a customer who drops a parcel off before the system has
 * marked it collected should not be turned away at the dock. What must be
 * refused is receiving something already received, inspected, resolved or
 * cancelled, which the checks below cover.
 */
const RECEIVABLE_STATUSES = new Set(['REQUESTED', 'APPROVED', 'PICKED_UP', 'IN_TRANSIT']);

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------

export interface ReceiveInput {
  returnId: string;
  packageCondition: PackageCondition;
  discrepancy: ReceivingDiscrepancy;
  receivedQuantity: number;
  trackingNumber?: string | null;
  carrier?: string | null;
  locationId?: string | null;
  notes?: string | null;
}

export interface ReceiveResult {
  receiving: ReceivingRecordRow;
  ret: ReturnRow;
}

/**
 * Record a parcel arriving at the dock.
 *
 * Moves the goods into the RETURNED inventory state, advances the return to
 * RECEIVED, and writes the customer-visible timeline event. The customer's
 * "Return Received" comes from that event — nothing pushes to the customer UI.
 */
export const receiveReturn = db.transaction((operator: Operator, input: ReceiveInput): ReceiveResult => {
  const ret = loadReturn(input.returnId);
  assertReturnSite(operator, input.returnId);

  if (ret.status === 'CANCELLED') {
    throw new HttpError(409, 'RETURN_CANCELLED', 'This return was cancelled and cannot be received');
  }
  if (!RECEIVABLE_STATUSES.has(ret.status)) {
    // Covers both "already received" and "not yet dispatched".
    const already = db.prepare('SELECT id FROM receiving_records WHERE return_id = ?').get(ret.id);
    if (already !== undefined) {
      throw new HttpError(409, 'ALREADY_RECEIVED', 'This return has already been received');
    }
    throw new HttpError(409, 'INVALID_RETURN_STATUS', `A return at ${ret.status} cannot be received`);
  }

  const items = returnItems(ret.id);
  if (items.length === 0) {
    throw new HttpError(422, 'RETURN_HAS_NO_ITEMS', 'This return has no items to receive');
  }
  const expectedQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  if (input.receivedQuantity > expectedQuantity) {
    throw new HttpError(
      422,
      'QUANTITY_EXCEEDS_EXPECTED',
      `Expected at most ${expectedQuantity} unit(s) but ${input.receivedQuantity} were entered`,
    );
  }
  // A short count is real and must be recorded as a discrepancy, not accepted quietly.
  if (input.receivedQuantity !== expectedQuantity && input.discrepancy === 'NONE') {
    throw new HttpError(
      422,
      'DISCREPANCY_REQUIRED',
      `Expected ${expectedQuantity} unit(s) but ${input.receivedQuantity} were received; record a discrepancy`,
    );
  }

  const pickup = db.prepare('SELECT tracking_number, carrier FROM pickups WHERE return_id = ?').get(ret.id) as
    | { tracking_number: string | null; carrier: string | null }
    | undefined;
  if (
    input.trackingNumber !== undefined &&
    input.trackingNumber !== null &&
    input.trackingNumber !== '' &&
    pickup?.tracking_number !== null &&
    pickup?.tracking_number !== undefined &&
    pickup.tracking_number !== input.trackingNumber
  ) {
    throw new HttpError(
      422,
      'TRACKING_MISMATCH',
      `Tracking number does not match the shipment expected for this return`,
    );
  }

  const now = nowIso();
  const receivingId = id();

  db.prepare(
    `INSERT INTO receiving_records (id, return_id, warehouse_id, location_id, received_by, tracking_number,
      carrier, package_condition, discrepancy, expected_quantity, received_quantity, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    receivingId,
    ret.id,
    operator.warehouseId,
    input.locationId ?? null,
    operator.id,
    input.trackingNumber ?? pickup?.tracking_number ?? null,
    input.carrier ?? pickup?.carrier ?? null,
    input.packageCondition,
    input.discrepancy,
    expectedQuantity,
    input.receivedQuantity,
    input.notes ?? null,
    now,
  );

  // Goods are physically here: book them into the RETURNED state.
  for (const item of items) {
    const product = lineProduct(item.id);
    applyMovement({
      warehouseId: operator.warehouseId,
      productId: product.productId,
      quantity: item.quantity,
      fromState: null,
      toState: 'RETURNED',
      reason: 'RETURN_RECEIVED',
      referenceType: 'RETURN',
      referenceId: ret.id,
      operatorId: operator.id,
      toLocationId: input.locationId ?? null,
    });
  }

  // Deliberately does not set approved_at. A parcel arriving proves delivery,
  // not that the claim was accepted; approval stays a separate decision and is
  // enforced before any money moves.
  db.prepare('UPDATE returns SET status = ?, updated_at = ? WHERE id = ?').run('RECEIVED', now, ret.id);
  db.prepare('UPDATE pickups SET status = ?, received_at = ?, updated_at = ? WHERE return_id = ?').run(
    'COMPLETED',
    now,
    now,
    ret.id,
  );
  insertReturnEvent(ret.id, 'RECEIVED', 'We received your item at our facility.');
  createNotification(ret.customer_id, {
    returnId: ret.id,
    type: 'RETURN_STATUS',
    title: 'Return received',
    body: `Return ${ret.return_number} arrived at our facility and is queued for inspection.`,
  });

  recordAudit({
    actorId: operator.id,
    actorRole: operator.role,
    warehouseId: operator.warehouseId,
    action: 'RETURN_RECEIVED',
    entityType: 'RETURN',
    entityId: ret.id,
    previousState: ret.status,
    newState: 'RECEIVED',
    metadata: {
      expectedQuantity,
      receivedQuantity: input.receivedQuantity,
      packageCondition: input.packageCondition,
      discrepancy: input.discrepancy,
      receivedBeforeApproval: ret.approved_at === null || ret.approved_at === undefined,
    },
  });

  // The parcel is in: close the receiving task and open the next one.
  completeTasksFor(ret.id, 'RECEIVE_RETURN', operator.id);
  createTask({
    warehouseId: operator.warehouseId,
    kind: 'INSPECT_ITEM',
    title: `Inspect ${ret.return_number}`,
    returnId: ret.id,
    priority: input.discrepancy === 'NONE' ? 'NORMAL' : 'HIGH',
  });

  if (ret.approved_at === null || ret.approved_at === undefined) {
    // Visible on the dashboard as work that cannot complete until reviewed.
    recordAudit({
      actorId: operator.id,
      actorRole: operator.role,
      warehouseId: operator.warehouseId,
      action: 'WARNING_RECEIVED_BEFORE_APPROVAL',
      entityType: 'RETURN',
      entityId: ret.id,
      previousState: ret.status,
      newState: 'RECEIVED',
      metadata: { note: 'Parcel accepted before the return was approved; resolution is blocked until approval.' },
    });
    createTask({
      warehouseId: operator.warehouseId,
      kind: 'REVIEW_APPROVAL',
      title: `Approve ${ret.return_number} (received unapproved)`,
      returnId: ret.id,
      priority: 'HIGH',
    });
  }

  return {
    receiving: db.prepare('SELECT * FROM receiving_records WHERE id = ?').get(receivingId) as ReceivingRecordRow,
    ret: loadReturn(ret.id),
  };
});

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

/** Open an inspection. Idempotent: reopening returns the existing record. */
export const startInspection = db.transaction((operator: Operator, returnId: string): InspectionRow => {
  const ret = loadReturn(returnId);
  assertReturnSite(operator, returnId);

  const existing = db.prepare('SELECT * FROM inspections WHERE return_id = ?').get(ret.id) as
    | InspectionRow
    | undefined;
  if (existing !== undefined) {
    if (existing.completed_at !== null) {
      throw new HttpError(409, 'INSPECTION_COMPLETED', 'This return has already been inspected');
    }
    return existing;
  }

  if (ret.status !== 'RECEIVED') {
    throw new HttpError(
      409,
      'NOT_RECEIVED',
      'A return must be received before it can be inspected',
    );
  }

  const now = nowIso();
  const inspectionId = id();
  db.prepare(
    `INSERT INTO inspections (id, return_id, warehouse_id, inspected_by, result, notes, started_at, completed_at)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL)`,
  ).run(inspectionId, ret.id, operator.warehouseId, operator.id, now);

  // Move the goods onto the inspection bench so the counts reflect reality.
  for (const item of returnItems(ret.id)) {
    const product = lineProduct(item.id);
    applyMovement({
      warehouseId: operator.warehouseId,
      productId: product.productId,
      quantity: item.quantity,
      fromState: 'RETURNED',
      toState: 'INSPECTION',
      reason: 'INSPECTION_STARTED',
      referenceType: 'RETURN',
      referenceId: ret.id,
      operatorId: operator.id,
    });
  }

  db.prepare('UPDATE returns SET status = ?, updated_at = ? WHERE id = ?').run('INSPECTION', now, ret.id);
  insertReturnEvent(ret.id, 'INSPECTION', 'Our team is inspecting your item.');
  createNotification(ret.customer_id, {
    returnId: ret.id,
    type: 'RETURN_STATUS',
    title: 'Inspection started',
    body: `Return ${ret.return_number} is being inspected.`,
  });

  startTasksFor(ret.id, 'INSPECT_ITEM', operator.id);

  recordAudit({
    actorId: operator.id,
    actorRole: operator.role,
    warehouseId: operator.warehouseId,
    action: 'INSPECTION_STARTED',
    entityType: 'RETURN',
    entityId: ret.id,
    previousState: ret.status,
    newState: 'INSPECTION',
  });

  return db.prepare('SELECT * FROM inspections WHERE id = ?').get(inspectionId) as InspectionRow;
});

export interface InspectionFinding {
  returnItemId: string;
  result: InspectionResult;
  productCondition: ConditionGrade;
  packagingCondition: ConditionGrade;
  quantity: number;
  missingComponents?: string | null;
  damageNotes?: string | null;
  serialNumber?: string | null;
}

export interface CompleteInspectionInput {
  returnId: string;
  findings: InspectionFinding[];
  notes?: string | null;
}

export interface InspectionDetail {
  inspection: InspectionRow;
  items: InspectionItemRow[];
  /** Dispositions the backend will accept per line, given each finding. */
  allowedDispositions: Record<string, readonly DispositionAction[]>;
}

/** Severity order used to summarise a multi-line inspection into one result. */
const RESULT_SEVERITY: Record<InspectionResult, number> = {
  PASS: 0,
  INCOMPLETE: 1,
  WRONG_ITEM: 2,
  DAMAGED: 3,
  DEFECTIVE: 4,
  UNSELLABLE: 5,
};

/**
 * Record findings and close the inspection.
 *
 * This decides only the *physical* verdict. It does not approve a refund or
 * issue credit: the resolution the customer chose still governs the financial
 * outcome, and that is applied once disposition is complete.
 */
export const completeInspection = db.transaction(
  (operator: Operator, input: CompleteInspectionInput): InspectionDetail => {
    const ret = loadReturn(input.returnId);
    assertReturnSite(operator, input.returnId);
    const inspection = db.prepare('SELECT * FROM inspections WHERE return_id = ?').get(ret.id) as
      | InspectionRow
      | undefined;
    if (inspection === undefined) {
      throw new HttpError(409, 'INSPECTION_NOT_STARTED', 'Start the inspection before completing it');
    }
    if (inspection.completed_at !== null) {
      throw new HttpError(409, 'INSPECTION_COMPLETED', 'This inspection is already complete');
    }

    const items = returnItems(ret.id);
    const itemsById = new Map(items.map((item) => [item.id, item]));
    if (input.findings.length !== items.length) {
      throw new HttpError(
        422,
        'INCOMPLETE_INSPECTION',
        `Record a finding for each of the ${items.length} returned line(s)`,
      );
    }

    const now = nowIso();
    const insertFinding = db.prepare(
      `INSERT INTO inspection_items (id, inspection_id, return_item_id, result, product_condition,
        packaging_condition, missing_components, damage_notes, serial_number, quantity, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const seen = new Set<string>();
    let worst: InspectionResult = 'PASS';
    for (const finding of input.findings) {
      const item = itemsById.get(finding.returnItemId);
      if (item === undefined) {
        throw new HttpError(422, 'INVALID_RETURN_ITEM', 'A finding does not belong to this return');
      }
      if (seen.has(finding.returnItemId)) {
        throw new HttpError(422, 'DUPLICATE_FINDING', 'Each returned line takes exactly one finding');
      }
      seen.add(finding.returnItemId);
      if (finding.quantity > item.quantity) {
        throw new HttpError(
          422,
          'QUANTITY_EXCEEDS_RETURNED',
          `Inspected quantity exceeds the ${item.quantity} unit(s) returned on this line`,
        );
      }
      insertFinding.run(
        id(),
        inspection.id,
        finding.returnItemId,
        finding.result,
        finding.productCondition,
        finding.packagingCondition,
        finding.missingComponents ?? null,
        finding.damageNotes ?? null,
        finding.serialNumber ?? null,
        finding.quantity,
        now,
      );
      if (RESULT_SEVERITY[finding.result] > RESULT_SEVERITY[worst]) {
        worst = finding.result;
      }
    }

    db.prepare('UPDATE inspections SET result = ?, notes = ?, completed_at = ? WHERE id = ?').run(
      worst,
      input.notes ?? null,
      now,
      inspection.id,
    );

    completeTasksFor(ret.id, 'INSPECT_ITEM', operator.id);
    createTask({
      warehouseId: operator.warehouseId,
      kind: 'PROCESS_DISPOSITION',
      title: `Disposition ${ret.return_number} (${worst})`,
      returnId: ret.id,
      priority: worst === 'PASS' ? 'NORMAL' : 'HIGH',
    });

    insertReturnEvent(ret.id, 'INSPECTION', 'Inspection completed. Your resolution is being processed.');
    recordAudit({
      actorId: operator.id,
      actorRole: operator.role,
      warehouseId: operator.warehouseId,
      action: 'INSPECTION_COMPLETED',
      entityType: 'RETURN',
      entityId: ret.id,
      previousState: 'INSPECTION',
      newState: 'INSPECTION',
      metadata: { result: worst, lines: input.findings.length },
    });

    return inspectionDetail(ret.id);
  },
);

/** Inspection with its findings and the dispositions each finding permits. */
export function inspectionDetail(returnId: string): InspectionDetail {
  const inspection = db.prepare('SELECT * FROM inspections WHERE return_id = ?').get(returnId) as
    | InspectionRow
    | undefined;
  if (inspection === undefined) {
    throw new HttpError(404, 'INSPECTION_NOT_FOUND', 'No inspection exists for this return');
  }
  const items = db
    .prepare('SELECT * FROM inspection_items WHERE inspection_id = ? ORDER BY created_at ASC')
    .all(inspection.id) as InspectionItemRow[];
  const allowedDispositions: Record<string, readonly DispositionAction[]> = {};
  for (const item of items) {
    allowedDispositions[item.return_item_id] = ALLOWED_DISPOSITIONS[item.result];
  }
  return { inspection, items, allowedDispositions };
}

// ---------------------------------------------------------------------------
// Disposition
// ---------------------------------------------------------------------------

export interface DispositionInput {
  returnItemId: string;
  action: DispositionAction;
  quantity: number;
  locationId?: string | null;
  reason?: string | null;
  notes?: string | null;
  recoveryValuePaise?: number;
}

export interface DispositionResult {
  disposition: DispositionRow;
  /** True when this was the last line and the return reached its resolution. */
  returnResolved: boolean;
  ret: ReturnRow;
}

/**
 * Record what physically happened to one returned line.
 *
 * When every line has a disposition, the return's financial resolution is
 * applied by delegating to `resolveReturnAtResolved`, which owns store credit,
 * refunds, replacements and exchanges.
 */
export const recordDisposition = db.transaction(
  (operator: Operator, input: DispositionInput): DispositionResult => {
    const item = db.prepare('SELECT * FROM return_items WHERE id = ?').get(input.returnItemId) as
      | ReturnItemRow
      | undefined;
    if (item === undefined) {
      throw new HttpError(404, 'RETURN_ITEM_NOT_FOUND', 'Return item not found');
    }
    const ret = loadReturn(item.return_id);
    assertReturnSite(operator, item.return_id);

    const inspection = db.prepare('SELECT * FROM inspections WHERE return_id = ?').get(ret.id) as
      | InspectionRow
      | undefined;
    if (inspection === undefined || inspection.completed_at === null) {
      throw new HttpError(409, 'INSPECTION_INCOMPLETE', 'Complete the inspection before disposing of items');
    }

    const existing = db.prepare('SELECT id FROM dispositions WHERE return_item_id = ?').get(item.id);
    if (existing !== undefined) {
      throw new HttpError(409, 'ALREADY_DISPOSED', 'This line has already been dispositioned');
    }

    const finding = db
      .prepare('SELECT * FROM inspection_items WHERE inspection_id = ? AND return_item_id = ?')
      .get(inspection.id, item.id) as InspectionItemRow | undefined;
    if (finding === undefined) {
      throw new HttpError(409, 'NO_INSPECTION_FINDING', 'This line was not inspected');
    }

    // The inspection verdict, not the client, decides which actions are legal.
    const allowed = ALLOWED_DISPOSITIONS[finding.result];
    if (!allowed.includes(input.action)) {
      throw new HttpError(
        422,
        'DISPOSITION_NOT_ALLOWED',
        `${input.action} is not permitted for an inspection result of ${finding.result}`,
      );
    }
    if (input.quantity > item.quantity) {
      throw new HttpError(
        422,
        'QUANTITY_EXCEEDS_RETURNED',
        `Disposition quantity exceeds the ${item.quantity} unit(s) returned on this line`,
      );
    }

    const now = nowIso();
    const product = lineProduct(item.id);
    const dispositionId = id();

    db.prepare(
      `INSERT INTO dispositions (id, return_item_id, return_id, inspection_id, warehouse_id, location_id,
        action, quantity, reason, notes, recovery_value_paise, operator_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      dispositionId,
      item.id,
      ret.id,
      inspection.id,
      operator.warehouseId,
      input.locationId ?? null,
      input.action,
      input.quantity,
      input.reason ?? null,
      input.notes ?? null,
      input.recoveryValuePaise ?? 0,
      operator.id,
      now,
    );

    // Move the goods out of INSPECTION into wherever this action sends them.
    // RESTOCK lands in AVAILABLE, which also raises products.stock in this
    // same transaction, so the storefront sees the unit immediately.
    applyMovement({
      warehouseId: operator.warehouseId,
      productId: product.productId,
      quantity: input.quantity,
      fromState: 'INSPECTION',
      toState: DISPOSITION_TARGET_STATE[input.action],
      reason: DISPOSITION_MOVEMENT_REASON[input.action],
      referenceType: 'RETURN_ITEM',
      referenceId: item.id,
      operatorId: operator.id,
      toLocationId: input.locationId ?? null,
    });

    recordAudit({
      actorId: operator.id,
      actorRole: operator.role,
      warehouseId: operator.warehouseId,
      action: 'DISPOSITION_COMPLETED',
      entityType: 'RETURN_ITEM',
      entityId: item.id,
      previousState: finding.result,
      newState: input.action,
      metadata: {
        returnId: ret.id,
        quantity: input.quantity,
        recoveryValuePaise: input.recoveryValuePaise ?? 0,
      },
    });

    // Once every line is accounted for, hand the financial outcome to the
    // existing resolution engine rather than deciding it here.
    const outstanding = db
      .prepare(
        `SELECT COUNT(*) AS count FROM return_items ri
          WHERE ri.return_id = ?
            AND NOT EXISTS (SELECT 1 FROM dispositions d WHERE d.return_item_id = ri.id)`,
      )
      .get(ret.id) as { count: number };

    let returnResolved = false;
    const approved = ret.approved_at !== null && ret.approved_at !== undefined;
    if (outstanding.count === 0 && !approved) {
      // The goods are handled, but the claim was never accepted. Stop short of
      // the financial outcome rather than paying out on an unapproved return.
      createTask({
        warehouseId: operator.warehouseId,
        kind: 'REVIEW_APPROVAL',
        title: `Approve ${ret.return_number} to release its resolution`,
        returnId: ret.id,
        priority: 'URGENT',
      });
      recordAudit({
        actorId: operator.id,
        actorRole: operator.role,
        warehouseId: operator.warehouseId,
        action: 'RESOLUTION_BLOCKED_PENDING_APPROVAL',
        entityType: 'RETURN',
        entityId: ret.id,
        previousState: 'INSPECTION',
        newState: 'INSPECTION',
        metadata: { reason: 'Return has no approval stamp' },
      });
    }
    if (outstanding.count === 0 && approved) {
      resolveReturnAtResolved(ret.id);
      returnResolved = true;
      completeTasksFor(ret.id, 'PROCESS_DISPOSITION', operator.id);
      recordAudit({
        actorId: operator.id,
        actorRole: operator.role,
        warehouseId: operator.warehouseId,
        action: 'RETURN_RESOLVED',
        entityType: 'RETURN',
        entityId: ret.id,
        previousState: 'INSPECTION',
        newState: 'RESOLVED',
        metadata: { resolutionType: ret.resolution_type },
      });
    }

    return {
      disposition: db.prepare('SELECT * FROM dispositions WHERE id = ?').get(dispositionId) as DispositionRow,
      returnResolved,
      ret: loadReturn(ret.id),
    };
  },
);

/**
 * Accept a return claim.
 *
 * Kept separate from receiving on purpose: nothing in this system approves a
 * return as a side effect of another action. Approving a return whose lines
 * are already dispositioned releases the resolution that was held back.
 */
export const approveReturn = db.transaction((operator: Operator, returnId: string): ReturnRow => {
  const ret = loadReturn(returnId);
  assertReturnSite(operator, returnId);
  if (ret.status === 'CANCELLED') {
    throw new HttpError(409, 'RETURN_CANCELLED', 'A cancelled return cannot be approved');
  }
  if (ret.approved_at !== null && ret.approved_at !== undefined) {
    throw new HttpError(409, 'ALREADY_APPROVED', 'This return has already been approved');
  }

  const now = nowIso();
  db.prepare('UPDATE returns SET approved_at = ?, approved_by = ?, updated_at = ? WHERE id = ?').run(
    now, operator.id, now, ret.id,
  );
  completeTasksFor(ret.id, 'REVIEW_APPROVAL', operator.id);
  insertReturnEvent(ret.id, 'APPROVED', 'Your return was approved.');
  createNotification(ret.customer_id, {
    returnId: ret.id,
    type: 'RETURN_STATUS',
    title: 'Return approved',
    body: `Return ${ret.return_number} was approved.`,
  });
  recordAudit({
    actorId: operator.id,
    actorRole: operator.role,
    warehouseId: operator.warehouseId,
    action: 'RETURN_APPROVED',
    entityType: 'RETURN',
    entityId: ret.id,
    previousState: 'PENDING_APPROVAL',
    newState: 'APPROVED',
  });

  // If the goods were already processed while approval was outstanding, the
  // held-back resolution can now run.
  const outstanding = db
    .prepare(
      `SELECT COUNT(*) AS count FROM return_items ri
        WHERE ri.return_id = ?
          AND NOT EXISTS (SELECT 1 FROM dispositions d WHERE d.return_item_id = ri.id)`,
    )
    .get(ret.id) as { count: number };
  const inspection = db.prepare('SELECT completed_at FROM inspections WHERE return_id = ?').get(ret.id) as
    | { completed_at: string | null }
    | undefined;
  if (outstanding.count === 0 && inspection?.completed_at !== null && inspection?.completed_at !== undefined) {
    resolveReturnAtResolved(ret.id);
    completeTasksFor(ret.id, 'PROCESS_DISPOSITION', operator.id);
    recordAudit({
      actorId: operator.id,
      actorRole: operator.role,
      warehouseId: operator.warehouseId,
      action: 'RETURN_RESOLVED',
      entityType: 'RETURN',
      entityId: ret.id,
      previousState: 'INSPECTION',
      newState: 'RESOLVED',
      metadata: { releasedByApproval: true },
    });
  }

  return loadReturn(ret.id);
});

/** Returns received but never approved, so resolution is held. */
export function pendingApprovalCount(): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM returns
          WHERE approved_at IS NULL AND status IN ('RECEIVED', 'INSPECTION')`,
      )
      .get() as { count: number }
  ).count;
}

/** Dispositions recorded against a return. */
export function dispositionsFor(returnId: string): DispositionRow[] {
  return db
    .prepare('SELECT * FROM dispositions WHERE return_id = ? ORDER BY created_at ASC')
    .all(returnId) as DispositionRow[];
}

/** The receiving record for a return, when it has been received. */
export function receivingFor(returnId: string): ReceivingRecordRow | null {
  return (
    (db.prepare('SELECT * FROM receiving_records WHERE return_id = ?').get(returnId) as
      | ReceivingRecordRow
      | undefined) ?? null
  );
}
