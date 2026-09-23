import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { requireAuth, requireWarehouse, requireWarehouseId } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { auditForEntity } from '../warehouse/audit.js';
import { bucketsFor, listInventory, listMovements } from '../warehouse/inventory.js';
import {
  approveReturn,
  completeInspection,
  dispositionsFor,
  inspectionDetail,
  pendingApprovalCount,
  receiveReturn,
  receivingFor,
  recordDisposition,
  startInspection,
} from '../warehouse/operations.js';
import { listQueue, queueCounts, queueEntry, returnLines } from '../warehouse/queue.js';
import { listShipments, recentReceiving, warehouseAnalytics } from '../warehouse/analytics.js';
import { listAudit } from '../warehouse/audit.js';
import { listTasks, overdueTasks, taskCounts, updateTask } from '../warehouse/tasks.js';
import { db } from '../db.js';
import {
  analyticsQuerySchema,
  auditQuerySchema,
  completeInspectionSchema,
  dispositionSchema,
  listQuerySchema,
  receiveSchema,
  taskQuerySchema,
  taskUpdateSchema,
} from '../warehouse/validation.js';

export const warehouseRouter = Router();

// Every route below requires the WAREHOUSE role and a warehouse assignment.
// Customers are rejected with 403 before any handler runs.
warehouseRouter.use(requireAuth, requireWarehouse);

/**
 * Parse a request against a schema and return its *output* type, so fields
 * carrying `.default()` come back populated rather than possibly-undefined.
 */
function validate<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw httpError(
      400,
      'VALIDATION_ERROR',
      'Request validation failed',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

/** The acting operator, scoped to their own warehouse. */
function operatorOf(req: Request): { id: string; role: string; warehouseId: string } {
  const warehouseId = requireWarehouseId(req);
  const user = req.user;
  if (user === undefined) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  return { id: user.id, role: user.role, warehouseId };
}

/**
 * A location must belong to the caller's warehouse. Without this check an
 * operator could file goods into another site's shelf by passing its id.
 */
function assertLocation(warehouseId: string, locationId: string | null | undefined): void {
  if (locationId === null || locationId === undefined || locationId === '') {
    return;
  }
  const row = db
    .prepare('SELECT id FROM warehouse_locations WHERE id = ? AND warehouse_id = ? AND active = 1')
    .get(locationId, warehouseId);
  if (row === undefined) {
    throw httpError(404, 'LOCATION_NOT_FOUND', 'Location not found in this warehouse');
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

warehouseRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const operator = operatorOf(req);
    const warehouse = db.prepare('SELECT id, code, name, city FROM warehouses WHERE id = ?').get(operator.warehouseId);
    const locations = db
      .prepare('SELECT id, code, name, kind FROM warehouse_locations WHERE warehouse_id = ? AND active = 1 ORDER BY code ASC')
      .all(operator.warehouseId);
    res.json({ operator: { id: operator.id, role: operator.role }, warehouse, locations });
  }),
);

// ---------------------------------------------------------------------------
// Return queue
// ---------------------------------------------------------------------------

warehouseRouter.get(
  '/returns',
  asyncHandler(async (req, res) => {
    const operator = operatorOf(req);
    const query = validate(listQuerySchema, req.query);
    res.json(listQueue({ status: query.status, search: query.search, limit: query.limit, offset: query.offset }, operator.warehouseId));
  }),
);

warehouseRouter.get(
  '/returns/:id',
  asyncHandler(async (req, res) => {
    const operator = operatorOf(req);
    const summary = queueEntry(req.params.id, operator.warehouseId);
    const inspection = db.prepare('SELECT id FROM inspections WHERE return_id = ?').get(req.params.id);
    res.json({
      summary,
      lines: returnLines(req.params.id),
      receiving: receivingFor(req.params.id),
      inspection: inspection === undefined ? null : inspectionDetail(req.params.id),
      dispositions: dispositionsFor(req.params.id),
      timeline: db
        .prepare('SELECT id, status, description, created_at FROM return_events WHERE return_id = ? ORDER BY created_at ASC')
        .all(req.params.id),
      documents: db
        .prepare('SELECT id, kind, filename, mime, size, created_at FROM documents WHERE return_id = ?')
        .all(req.params.id),
      audit: auditForEntity(operator.warehouseId, 'RETURN', req.params.id),
    });
  }),
);

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

warehouseRouter.post(
  '/returns/:id/approve',
  asyncHandler(async (req, res) => {
    const operator = operatorOf(req);
    res.json({ ret: approveReturn(operator, req.params.id) });
  }),
);

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------

warehouseRouter.post(
  '/returns/:id/receive',
  asyncHandler(async (req, res) => {
    const operator = operatorOf(req);
    const body = validate(receiveSchema, req.body);
    assertLocation(operator.warehouseId, body.locationId);
    const result = receiveReturn(operator, { returnId: req.params.id, ...body });
    res.status(201).json(result);
  }),
);

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

warehouseRouter.post(
  '/returns/:id/inspection/start',
  asyncHandler(async (req, res) => {
    const operator = operatorOf(req);
    res.status(201).json({ inspection: startInspection(operator, req.params.id) });
  }),
);

warehouseRouter.post(
  '/returns/:id/inspection/complete',
  asyncHandler(async (req, res) => {
    const operator = operatorOf(req);
    const body = validate(completeInspectionSchema, req.body);
    res.json(completeInspection(operator, { returnId: req.params.id, ...body }));
  }),
);

// ---------------------------------------------------------------------------
// Disposition
// ---------------------------------------------------------------------------

warehouseRouter.post(
  '/returns/:id/disposition',
  asyncHandler(async (req, res) => {
    const operator = operatorOf(req);
    const body = validate(dispositionSchema, req.body);
    assertLocation(operator.warehouseId, body.locationId);

    // The line must belong to the return named in the path.
    const line = db
      .prepare('SELECT return_id FROM return_items WHERE id = ?')
      .get(body.returnItemId) as { return_id: string } | undefined;
    if (line === undefined || line.return_id !== req.params.id) {
      throw httpError(404, 'RETURN_ITEM_NOT_FOUND', 'Return item not found on this return');
    }

    res.status(201).json(recordDisposition(operator, body));
  }),
);

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

warehouseRouter.get(
  '/inventory',
  asyncHandler(async (req, res) => {
    const operator = operatorOf(req);
    const query = validate(listQuerySchema, req.query);
    let lines = listInventory(operator.warehouseId);
    if (query.search !== undefined && query.search.trim() !== '') {
      const term = query.search.trim().toLowerCase();
      lines = lines.filter((line) => `${line.name} ${line.sku}`.toLowerCase().includes(term));
    }
    res.json({ inventory: lines, total: lines.length });
  }),
);

warehouseRouter.get(
  '/inventory/:productId',
  asyncHandler(async (req, res) => {
    const operator = operatorOf(req);
    const buckets = bucketsFor(operator.warehouseId, req.params.productId);
    const product = db
      .prepare('SELECT id, sku, name, stock FROM products WHERE id = ?')
      .get(req.params.productId);
    if (product === undefined) {
      throw httpError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    }
    res.json({ product, buckets });
  }),
);

warehouseRouter.get(
  '/inventory-movements',
  asyncHandler(async (req, res) => {
    const operator = operatorOf(req);
    const query = validate(listQuerySchema, req.query);
    res.json(
      listMovements({
        warehouseId: operator.warehouseId,
        productId: query.productId,
        reason: query.reason,
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }),
);

// ---------------------------------------------------------------------------
// Dashboard counts
// ---------------------------------------------------------------------------

warehouseRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const operator = operatorOf(req);
    const counts = queueCounts(operator.warehouseId);
    const pendingInspection = counts.RECEIVED ?? 0;
    const inInspection = counts.INSPECTION ?? 0;
    const awaitingArrival = (counts.APPROVED ?? 0) + (counts.PICKED_UP ?? 0) + (counts.IN_TRANSIT ?? 0);
    const overdue = listQueue({ limit: 100, offset: 0 }, operator.warehouseId).returns.filter((row) => row.overdue).length;
    const movementsToday = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM inventory_movements
            WHERE warehouse_id = ? AND created_at >= ?`,
        )
        .get(operator.warehouseId, new Date(Date.now() - 86_400_000).toISOString()) as { count: number }
    ).count;

    // Operational warnings raised in the last day, so drift and approval gaps
    // are visible rather than buried in the audit table.
    const warnings = db
      .prepare(
        `SELECT action, COUNT(*) AS count FROM audit_log
          WHERE warehouse_id = ? AND action LIKE 'WARNING_%' AND created_at >= ?
          GROUP BY action`,
      )
      .all(operator.warehouseId, new Date(Date.now() - 86_400_000).toISOString()) as Array<{
      action: string;
      count: number;
    }>;

    const tasks = taskCounts(operator.warehouseId);

    res.json({
      awaitingArrival,
      pendingInspection,
      inInspection,
      pendingApproval: pendingApprovalCount(),
      resolved: counts.RESOLVED ?? 0,
      overdue,
      movementsToday,
      tasks,
      // The overdue tasks themselves, not just a count, so the dashboard can
      // name the work that has breached its SLA rather than only tally it.
      overdueTasks: overdueTasks(operator.warehouseId, 5),
      warnings,
    });
  }),
);

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

warehouseRouter.get(
  '/tasks',
  asyncHandler(async (req, res) => {
    const operator = operatorOf(req);
    const query = validate(taskQuerySchema, req.query);
    res.json(
      listTasks({
        warehouseId: operator.warehouseId,
        status: query.taskStatus,
        kind: query.kind,
        assignedTo: query.assignedTo,
        overdueOnly: query.overdueOnly,
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }),
);

warehouseRouter.patch(
  '/tasks/:id',
  asyncHandler(async (req, res) => {
    const operator = operatorOf(req);
    const body = validate(taskUpdateSchema, req.body);
    res.json({ task: updateTask(operator, req.params.id, body) });
  }),
);

/** Claim a task for the signed-in operator in one call. */
warehouseRouter.post(
  '/tasks/:id/claim',
  asyncHandler(async (req, res) => {
    const operator = operatorOf(req);
    res.json({ task: updateTask(operator, req.params.id, { status: 'IN_PROGRESS', assignedTo: operator.id }) });
  }),
);

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------

warehouseRouter.get(
  '/shipments',
  asyncHandler(async (req, res) => {
    const operator = operatorOf(req);
    const query = validate(listQuerySchema, req.query);
    res.json({
      ...listShipments(query.limit, query.offset),
      recentReceiving: recentReceiving(operator.warehouseId, 10),
    });
  }),
);

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

warehouseRouter.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const operator = operatorOf(req);
    const query = validate(analyticsQuerySchema, req.query);
    res.json(warehouseAnalytics(operator.warehouseId, query.windowDays));
  }),
);

// ---------------------------------------------------------------------------
// Audit
//
// Read-only by design: there is no route that writes, edits or deletes an
// audit row, so warehouse users cannot rewrite their own history.
// ---------------------------------------------------------------------------

warehouseRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const operator = operatorOf(req);
    const query = validate(auditQuerySchema, req.query);
    res.json(
      listAudit({
        warehouseId: operator.warehouseId,
        entityType: query.entityType,
        entityId: query.entityId,
        actorId: query.actorId,
        limit: query.limit,
        offset: query.offset,
      }),
    );
  }),
);
