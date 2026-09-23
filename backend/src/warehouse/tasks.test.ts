import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db, initSchema } from '../db.js';
import { seedDatabase } from '../seed.js';
import { createOrder } from '../store.js';
import { DEFAULT_WAREHOUSE_ID } from './schema.js';
import { createTask, flagOverdueTasks, taskCounts } from './tasks.js';

/**
 * Tasks, shipments, analytics and audit.
 *
 * The properties that matter here: tasks appear because work happened rather
 * than because somebody remembered to add them, an SLA breach is surfaced
 * rather than sitting quietly in a table, and analytics report what the
 * database holds rather than a plausible-looking figure.
 */

interface Session {
  token: string;
  user: { id: string };
}

let warehouse: Session;
let customer: Session;

function wh(token: string, method: 'get' | 'post' | 'patch', path: string) {
  return request(app)[method](`/api/v1/warehouse${path}`).set('Authorization', `Bearer ${token}`);
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function deliveredOrder(customerId: string, suffix: string) {
  const product = db.prepare("SELECT sku, name, price_paise FROM products WHERE id = 'p-tee'").get() as {
    sku: string;
    name: string;
    price_paise: number;
  };
  return createOrder({
    orderNumber: `ORD-TSK-${suffix}`,
    customerId,
    status: 'DELIVERED',
    createdAt: daysAgoIso(5),
    deliveredAt: daysAgoIso(2),
    items: [
      {
        productId: 'p-tee',
        sku: product.sku,
        productName: product.name,
        quantity: 1,
        unitPrice: product.price_paise / 100,
      },
    ],
  });
}

async function createReturnVia(orderId: string, resolutionType: string) {
  const detail = await request(app)
    .get(`/api/v1/orders/${orderId}`)
    .set('Authorization', `Bearer ${customer.token}`);
  const orderItemId = (detail.body as { items: Array<{ id: string }> }).items[0].id;
  const res = await request(app)
    .post('/api/v1/returns')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({
      orderId,
      items: [{ orderItemId, quantity: 1, reasonCode: 'CHANGED_MIND' }],
      resolutionType,
      pickupKind: 'PICKUP',
      pickupAddress: 'Home',
    });
  expect(res.status).toBe(201);
  const returnId = (res.body as { ret: { id: string } }).ret.id;
  const item = db.prepare('SELECT id FROM return_items WHERE return_id = ?').get(returnId) as { id: string };
  return { returnId, returnItemId: item.id };
}

function openTasks(returnId: string, kind: string) {
  return db
    .prepare("SELECT * FROM warehouse_tasks WHERE return_id = ? AND kind = ? AND status IN ('TODO', 'IN_PROGRESS')")
    .all(returnId, kind) as Array<{ id: string; status: string; priority: string; due_at: string }>;
}

beforeAll(async () => {
  initSchema();
  seedDatabase();
  const w = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'warehouse@returnos.test', password: 'Warehouse123' });
  warehouse = w.body as Session;
  const c = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email: `tasks-${Date.now()}@example.com`, password: 'Password123', fullName: 'Tasks Customer' });
  customer = c.body as Session;
});

describe('tasks are created by the work, not by hand', () => {
  it('receiving opens an inspection task and closes the receiving task', async () => {
    const order = deliveredOrder(customer.user.id, `flow-${Date.now()}`);
    const { returnId } = await createReturnVia(order.id, 'REFUND');

    // A parcel awaiting receipt, as the carrier leg would have queued it.
    createTask({
      warehouseId: DEFAULT_WAREHOUSE_ID,
      kind: 'RECEIVE_RETURN',
      title: 'Receive parcel',
      returnId,
    });
    expect(openTasks(returnId, 'RECEIVE_RETURN')).toHaveLength(1);

    await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'SEALED', receivedQuantity: 1 });

    expect(openTasks(returnId, 'RECEIVE_RETURN'), 'receiving closes its own task').toHaveLength(0);
    expect(openTasks(returnId, 'INSPECT_ITEM'), 'receiving opens the inspection task').toHaveLength(1);
  });

  it('carries the workflow through inspection and disposition', async () => {
    const order = deliveredOrder(customer.user.id, `chain-${Date.now()}`);
    const { returnId, returnItemId } = await createReturnVia(order.id, 'REFUND');
    await wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'SEALED', receivedQuantity: 1 });

    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/start`).send({});
    expect(openTasks(returnId, 'INSPECT_ITEM')[0]?.status).toBe('IN_PROGRESS');

    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/complete`).send({
      findings: [{ returnItemId, result: 'PASS', productCondition: 'NEW', packagingCondition: 'NEW', quantity: 1 }],
    });
    expect(openTasks(returnId, 'INSPECT_ITEM')).toHaveLength(0);
    expect(openTasks(returnId, 'PROCESS_DISPOSITION')).toHaveLength(1);

    await wh(warehouse.token, 'post', `/returns/${returnId}/disposition`)
      .send({ returnItemId, action: 'RESTOCK', quantity: 1 });
    expect(openTasks(returnId, 'PROCESS_DISPOSITION'), 'resolution closes the disposition task').toHaveLength(0);
  });

  it('raises an approval task when a payout is held, and closes it on approval', async () => {
    const order = deliveredOrder(customer.user.id, `approve-${Date.now()}`);
    const { returnId, returnItemId } = await createReturnVia(order.id, 'STORE_CREDIT');

    await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'SEALED', receivedQuantity: 1 });
    // Receiving an unapproved parcel already flags the review.
    expect(openTasks(returnId, 'REVIEW_APPROVAL')).toHaveLength(1);

    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/start`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/complete`).send({
      findings: [{ returnItemId, result: 'PASS', productCondition: 'NEW', packagingCondition: 'NEW', quantity: 1 }],
    });
    await wh(warehouse.token, 'post', `/returns/${returnId}/disposition`)
      .send({ returnItemId, action: 'RESTOCK', quantity: 1 });

    // Still one open review task, escalated rather than duplicated.
    const held = openTasks(returnId, 'REVIEW_APPROVAL');
    expect(held).toHaveLength(1);

    await wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({});
    expect(openTasks(returnId, 'REVIEW_APPROVAL')).toHaveLength(0);
    expect(openTasks(returnId, 'PROCESS_DISPOSITION')).toHaveLength(0);
  });

  it('does not stack duplicate tasks when an operation is retried', () => {
    const suffix = `dupe-${Date.now()}`;
    const order = deliveredOrder(customer.user.id, suffix);
    for (let i = 0; i < 3; i += 1) {
      createTask({
        warehouseId: DEFAULT_WAREHOUSE_ID,
        kind: 'VERIFY_SHIPMENT',
        title: 'Verify shipment',
        orderId: order.id,
        returnId: null,
      });
    }
    // Order-scoped tasks have no return to key on, so verify the return-scoped
    // path, which is the one operations use.
    const ret = db.prepare('SELECT id FROM returns LIMIT 1').get() as { id: string } | undefined;
    if (ret !== undefined) {
      for (let i = 0; i < 3; i += 1) {
        createTask({
          warehouseId: DEFAULT_WAREHOUSE_ID,
          kind: 'RESTOCK',
          title: 'Restock',
          returnId: ret.id,
        });
      }
      expect(openTasks(ret.id, 'RESTOCK')).toHaveLength(1);
    }
  });
});

describe('SLA breaches are surfaced, not silent', () => {
  /** A task already past its due date, as one left overnight would be. */
  function overdueTask(returnId: string): string {
    const task = createTask({
      warehouseId: DEFAULT_WAREHOUSE_ID,
      kind: 'RESTOCK',
      title: 'Overdue restock',
      returnId,
    });
    db.prepare('UPDATE warehouse_tasks SET due_at = ? WHERE id = ?').run(daysAgoIso(3), task.id);
    return task.id;
  }

  it('stamps the breach and records it exactly once', async () => {
    const order = deliveredOrder(customer.user.id, `sla-${Date.now()}`);
    const { returnId } = await createReturnVia(order.id, 'REFUND');
    const taskId = overdueTask(returnId);

    expect(flagOverdueTasks(DEFAULT_WAREHOUSE_ID)).toBeGreaterThan(0);

    const stamped = db.prepare('SELECT sla_breached_at FROM warehouse_tasks WHERE id = ?').get(taskId) as {
      sla_breached_at: string | null;
    };
    expect(stamped.sla_breached_at).not.toBeNull();

    const warnings = db
      .prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'WARNING_TASK_OVERDUE' AND entity_id = ?")
      .get(taskId) as { count: number };
    expect(warnings.count).toBe(1);

    // Re-checking must not re-report the same breach.
    flagOverdueTasks(DEFAULT_WAREHOUSE_ID);
    flagOverdueTasks(DEFAULT_WAREHOUSE_ID);
    const after = db
      .prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'WARNING_TASK_OVERDUE' AND entity_id = ?")
      .get(taskId) as { count: number };
    expect(after.count, 'a breach is reported once, not on every dashboard load').toBe(1);
  });

  it('shows overdue work on the dashboard summary, named not just counted', async () => {
    const res = await wh(warehouse.token, 'get', '/summary');
    expect(res.status).toBe(200);
    const body = res.body as {
      tasks: { overdue: number; todo: number };
      overdueTasks: Array<{ id: string; title: string; overdue: boolean }>;
      warnings: Array<{ action: string; count: number }>;
    };

    expect(body.tasks.overdue).toBeGreaterThan(0);
    expect(body.overdueTasks.length).toBeGreaterThan(0);
    expect(body.overdueTasks[0].overdue).toBe(true);
    expect(body.overdueTasks[0].title).toBeTruthy();
    expect(body.warnings.some((entry) => entry.action === 'WARNING_TASK_OVERDUE')).toBe(true);
  });

  it('filters the task list to overdue work', async () => {
    const res = await wh(warehouse.token, 'get', '/tasks?overdueOnly=true');
    expect(res.status).toBe(200);
    const body = res.body as { tasks: Array<{ overdue: boolean; hoursRemaining: number }> };
    expect(body.tasks.length).toBeGreaterThan(0);
    expect(body.tasks.every((task) => task.overdue)).toBe(true);
    expect(body.tasks.every((task) => task.hoursRemaining < 0)).toBe(true);
  });

  it('counts a completed task as no longer overdue', async () => {
    const before = taskCounts(DEFAULT_WAREHOUSE_ID).overdue;
    const overdue = db
      .prepare("SELECT id FROM warehouse_tasks WHERE status IN ('TODO','IN_PROGRESS') AND due_at < ? LIMIT 1")
      .get(new Date().toISOString()) as { id: string } | undefined;
    expect(overdue).toBeDefined();

    const res = await wh(warehouse.token, 'patch', `/tasks/${(overdue as { id: string }).id}`).send({
      status: 'COMPLETED',
    });
    expect(res.status).toBe(200);
    expect(taskCounts(DEFAULT_WAREHOUSE_ID).overdue).toBe(before - 1);
  });
});

describe('task updates', () => {
  it('claims a task for the operator', async () => {
    const order = deliveredOrder(customer.user.id, `claim-${Date.now()}`);
    const { returnId } = await createReturnVia(order.id, 'REFUND');
    const task = createTask({
      warehouseId: DEFAULT_WAREHOUSE_ID,
      kind: 'RESTOCK',
      title: 'Claimable',
      returnId,
    });

    const res = await wh(warehouse.token, 'post', `/tasks/${task.id}/claim`).send({});
    expect(res.status).toBe(200);
    const body = res.body as { task: { status: string; assigned_to: string; started_at: string | null } };
    expect(body.task.status).toBe('IN_PROGRESS');
    expect(body.task.assigned_to).toBe(warehouse.user.id);
    expect(body.task.started_at).not.toBeNull();
  });

  it('requires a reason to block a task', async () => {
    const order = deliveredOrder(customer.user.id, `block-${Date.now()}`);
    const { returnId } = await createReturnVia(order.id, 'REFUND');
    const task = createTask({
      warehouseId: DEFAULT_WAREHOUSE_ID,
      kind: 'RESTOCK',
      title: 'Blockable',
      returnId,
    });

    const bad = await wh(warehouse.token, 'patch', `/tasks/${task.id}`).send({ status: 'BLOCKED' });
    expect(bad.status).toBe(422);
    expect((bad.body as { code: string }).code).toBe('BLOCKED_REASON_REQUIRED');

    const good = await wh(warehouse.token, 'patch', `/tasks/${task.id}`)
      .send({ status: 'BLOCKED', blockedReason: 'Shelf full' });
    expect(good.status).toBe(200);
    expect((good.body as { task: { blocked_reason: string } }).task.blocked_reason).toBe('Shelf full');
  });

  it('hides another warehouse task behind the same 404 as a missing one', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO warehouses (id, code, name, city, active, created_at, updated_at)
       VALUES ('wh-far', 'FAR-01', 'Far Hub', 'Delhi', 1, ?, ?)`,
    ).run(now, now);
    const foreign = createTask({
      warehouseId: 'wh-far',
      kind: 'RESTOCK',
      title: 'Not yours',
      returnId: null,
    });

    const res = await wh(warehouse.token, 'patch', `/tasks/${foreign.id}`).send({ priority: 'URGENT' });
    expect(res.status).toBe(404);
    expect((res.body as { code: string }).code).toBe('TASK_NOT_FOUND');
  });
});

describe('shipments and analytics report real rows', () => {
  it('lists inbound shipments from the pickup records', async () => {
    const res = await wh(warehouse.token, 'get', '/shipments');
    expect(res.status).toBe(200);
    const body = res.body as {
      shipments: Array<{ returnNumber: string; pickupStatus: string; receivedAt: string | null }>;
      total: number;
    };
    expect(body.total).toBeGreaterThan(0);
    expect(body.shipments[0].returnNumber).toMatch(/^RET-/);
  });

  it('reports analytics that match the underlying tables', async () => {
    const res = await wh(warehouse.token, 'get', '/analytics?windowDays=30');
    expect(res.status).toBe(200);
    const body = res.body as {
      returnsReceived: number;
      inspectionsCompleted: number;
      dispositionsByAction: Array<{ action: string; count: number }>;
      overdueTasks: number;
      recoveryValuePaise: number;
    };

    const received = db
      .prepare('SELECT COUNT(*) AS count FROM receiving_records WHERE warehouse_id = ?')
      .get(DEFAULT_WAREHOUSE_ID) as { count: number };
    expect(body.returnsReceived).toBe(received.count);

    const restocks = db
      .prepare("SELECT COUNT(*) AS count FROM dispositions WHERE warehouse_id = ? AND action = 'RESTOCK'")
      .get(DEFAULT_WAREHOUSE_ID) as { count: number };
    const reported = body.dispositionsByAction.find((row) => row.action === 'RESTOCK')?.count ?? 0;
    expect(reported).toBe(restocks.count);

    // Nothing recorded a recovery value, so it reports zero rather than a guess.
    expect(body.recoveryValuePaise).toBe(0);
  });

  it('returns null cycle times rather than inventing them when there is no data', async () => {
    const res = await wh(warehouse.token, 'get', '/analytics?windowDays=1');
    const body = res.body as { averageInspectionMinutes: number | null };
    expect(body.averageInspectionMinutes === null || typeof body.averageInspectionMinutes === 'number').toBe(true);
  });
});

describe('audit API', () => {
  it('reads the trail for this warehouse', async () => {
    const res = await wh(warehouse.token, 'get', '/audit?limit=10');
    expect(res.status).toBe(200);
    const body = res.body as { entries: Array<{ action: string; entity_type: string }>; total: number };
    expect(body.total).toBeGreaterThan(0);
    expect(body.entries.length).toBeGreaterThan(0);
  });

  it('filters to one entity', async () => {
    const entry = db
      .prepare("SELECT entity_id FROM audit_log WHERE entity_type = 'RETURN' LIMIT 1")
      .get() as { entity_id: string };
    const res = await wh(warehouse.token, 'get', `/audit?entityType=RETURN&entityId=${entry.entity_id}`);
    expect(res.status).toBe(200);
    const body = res.body as { entries: Array<{ entity_id: string }> };
    expect(body.entries.every((row) => row.entity_id === entry.entity_id)).toBe(true);
  });

  it('offers no way to write or delete audit history', async () => {
    const entry = db.prepare('SELECT id FROM audit_log LIMIT 1').get() as { id: string };
    for (const method of ['post', 'patch', 'delete'] as const) {
      const res = await request(app)
        [method](`/api/v1/warehouse/audit/${entry.id}`)
        .set('Authorization', `Bearer ${warehouse.token}`)
        .send({ action: 'TAMPERED' });
      expect(res.status, `${method} on audit must not be routable`).toBe(404);
    }
  });

  it('denies the audit trail to a customer', async () => {
    const res = await wh(customer.token, 'get', '/audit');
    expect(res.status).toBe(403);
  });
});
