import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db, initSchema } from '../db.js';
import { seedDatabase } from '../seed.js';
import { createOrder } from '../store.js';
import { createTask } from '../warehouse/tasks.js';
import { DEFAULT_WAREHOUSE_ID } from '../warehouse/schema.js';

/**
 * Phase 5 — warehouse and operator lifecycle from the admin side.
 *
 * Guard discipline: a site with open tasks or unprocessed parcels, and an
 * operator holding either, cannot be switched off — the refusal names the
 * blocking work. Disabling is enforced, not cosmetic: the site's operators
 * lose floor access and disabled accounts lose all access immediately.
 */

interface Session {
  token: string;
  user: { id: string };
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
}

async function signupCustomer(prefix: string): Promise<Session> {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email: uniqueEmail(prefix), password: 'Password123', fullName: `${prefix} Customer` });
  expect(res.status).toBe(201);
  return res.body as Session;
}

async function loginAdmin(): Promise<Session> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@returnos.test', password: 'Admin123' });
  expect(res.status).toBe(200);
  return res.body as Session;
}

async function loginAs(email: string, password: string) {
  return request(app).post('/api/v1/auth/login').send({ email, password });
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

let admin: Session;
let customer: Session;
let siteId = '';
let opEmail = '';
let operatorToken = '';
let operatorId = '';

beforeAll(async () => {
  initSchema();
  seedDatabase();
  admin = await loginAdmin();
  customer = await signupCustomer('site');
});

function adminReq(method: 'get' | 'post' | 'patch', path: string) {
  return request(app)[method](`/api/v1/admin${path}`).set('Authorization', `Bearer ${admin.token}`);
}

function wh(token: string, method: 'get' | 'post' | 'patch', path: string) {
  return request(app)[method](`/api/v1/warehouse${path}`).set('Authorization', `Bearer ${token}`);
}

/** A delivered order for the shared customer, straight into the database. */
function deliveredOrder(suffix: string) {
  const product = db.prepare('SELECT sku, name, price_paise FROM products WHERE id = ?').get('p-tee') as {
    sku: string;
    name: string;
    price_paise: number;
  };
  return createOrder({
    orderNumber: `ORD-SITE-${suffix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    customerId: customer.user.id,
    status: 'DELIVERED',
    createdAt: daysAgoIso(5),
    deliveredAt: daysAgoIso(2),
    items: [{ productId: 'p-tee', sku: product.sku, productName: product.name, quantity: 1, unitPrice: 1 }],
  });
}

async function createReturnVia(orderId: string): Promise<{ returnId: string; returnItemId: string; returnNumber: string }> {
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
      resolutionType: 'REFUND',
      pickupKind: 'PICKUP',
      pickupAddress: 'Home',
    });
  expect(res.status).toBe(201);
  const body = res.body as { ret: { id: string; return_number: string } };
  const item = db.prepare('SELECT id FROM return_items WHERE return_id = ?').get(body.ret.id) as { id: string };
  return { returnId: body.ret.id, returnItemId: item.id, returnNumber: body.ret.return_number };
}

describe('warehouse lifecycle', () => {
  it('creates a site with standard locations, audited', async () => {
    const res = await adminReq('post', '/warehouses').send({ code: 'TST-01', name: 'Test Hub', city: 'Pune' });
    expect(res.status).toBe(201);
    const warehouse = (res.body as { warehouse: { id: string; code: string } }).warehouse;
    siteId = warehouse.id;
    expect(warehouse.code).toBe('TST-01');

    const detail = await adminReq('get', `/warehouses/${siteId}`);
    expect(detail.status).toBe(200);
    expect(((detail.body as { locations: unknown[] }).locations).length).toBe(4);

    const audit = db
      .prepare("SELECT COUNT(*) AS count FROM admin_audit_log WHERE entity_type = 'WAREHOUSE' AND entity_id = ? AND action = 'WAREHOUSE_CREATED'")
      .get(siteId) as { count: number };
    expect(audit.count).toBe(1);

    const dup = await adminReq('post', '/warehouses').send({ code: 'TST-01', name: 'Dupe' });
    expect(dup.status).toBe(409);
    expect((dup.body as { code: string }).code).toBe('WAREHOUSE_CODE_EXISTS');
  });

  it('refuses to disable a site with open work, naming it', async () => {
    opEmail = uniqueEmail('siteop');
    const created = await adminReq('post', '/warehouse-users').send({
      email: opEmail,
      password: 'Operator123',
      fullName: 'Site Operator',
      warehouseId: siteId,
    });
    expect(created.status).toBe(201);
    operatorId = (created.body as { user: { id: string } }).user.id;
    const login = await loginAs(opEmail, 'Operator123');
    expect(login.status).toBe(200);
    operatorToken = (login.body as Session).token;

    // Real floor work on the new site: approve + receive one return there.
    const order = deliveredOrder('w1');
    const { returnId, returnNumber } = await createReturnVia(order.id);
    expect((await wh(operatorToken, 'post', `/returns/${returnId}/approve`).send({})).status).toBe(200);
    expect(
      (await wh(operatorToken, 'post', `/returns/${returnId}/receive`).send({ packageCondition: 'SEALED', receivedQuantity: 1 })).status,
    ).toBe(201);

    const res = await adminReq('patch', `/warehouses/${siteId}`).send({ active: false });
    expect(res.status).toBe(409);
    const body = res.body as {
      code: string;
      errors: { openTasks: number; pendingReturns: number; taskTitles: string[]; returnNumbers: string[] };
    };
    expect(body.code).toBe('WAREHOUSE_HAS_OPEN_WORK');
    expect(body.errors.openTasks).toBeGreaterThanOrEqual(1);
    expect(body.errors.pendingReturns).toBe(1);
    expect(body.errors.returnNumbers).toContain(returnNumber);

    // The site is untouched by the refusal.
    const detail = await adminReq('get', `/warehouses/${siteId}`);
    expect((detail.body as { active: number }).active).toBe(1);
  });

  it('disables cleanly once the work is done, and the floor feels it', async () => {
    // Finish everything at the site through the floor API.
    const pending = db
      .prepare('SELECT id FROM returns WHERE status IN (?, ?) AND id IN (SELECT return_id FROM receiving_records WHERE warehouse_id = ?)')
      .all('RECEIVED', 'INSPECTION', siteId) as Array<{ id: string }>;
    for (const row of pending) {
      const lines = db.prepare('SELECT id FROM return_items WHERE return_id = ?').all(row.id) as Array<{ id: string }>;
      await wh(operatorToken, 'post', `/returns/${row.id}/inspection/start`).send({});
      await wh(operatorToken, 'post', `/returns/${row.id}/inspection/complete`).send({
        findings: lines.map((line) => ({
          returnItemId: line.id,
          result: 'PASS',
          productCondition: 'LIKE_NEW',
          packagingCondition: 'NEW',
          quantity: 1,
        })),
      });
      for (const line of lines) {
        await wh(operatorToken, 'post', `/returns/${row.id}/disposition`).send({
          returnItemId: line.id,
          action: 'RESTOCK',
          quantity: 1,
        });
      }
    }
    const open = db
      .prepare("SELECT id FROM warehouse_tasks WHERE warehouse_id = ? AND status IN ('TODO', 'IN_PROGRESS')")
      .all(siteId) as Array<{ id: string }>;
    for (const task of open) {
      await wh(operatorToken, 'patch', `/tasks/${task.id}`).send({ status: 'COMPLETED' });
    }

    const res = await adminReq('patch', `/warehouses/${siteId}`).send({ active: false });
    expect(res.status).toBe(200);
    expect((res.body as { warehouse: { active: number } }).warehouse.active).toBe(0);

    // Enforcement, not theater: the site's operators lose floor access.
    const blocked = await wh(operatorToken, 'get', '/returns');
    expect(blocked.status).toBe(403);
    expect((blocked.body as { code: string }).code).toBe('WAREHOUSE_DISABLED');

    const back = await adminReq('patch', `/warehouses/${siteId}`).send({ active: true });
    expect(back.status).toBe(200);
    expect((await wh(operatorToken, 'get', '/returns')).status).toBe(200);
  });

  it('404s unknown warehouses', async () => {
    expect((await adminReq('get', '/warehouses/nope')).status).toBe(404);
  });
});

describe('operator lifecycle', () => {
  it('creates operators that can sign in, never leaking hashes', async () => {
    const email = uniqueEmail('op2');
    const res = await adminReq('post', '/warehouse-users').send({
      email,
      password: 'Operator123',
      fullName: 'Second Operator',
      warehouseId: DEFAULT_WAREHOUSE_ID,
    });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body).includes('password_hash')).toBe(false);
    const id = (res.body as { user: { id: string } }).user.id;

    const login = await loginAs(email, 'Operator123');
    expect(login.status).toBe(200);

    const dup = await adminReq('post', '/warehouse-users').send({
      email,
      password: 'Operator123',
      fullName: 'Dupe',
      warehouseId: DEFAULT_WAREHOUSE_ID,
    });
    expect(dup.status).toBe(409);

    const audit = db
      .prepare("SELECT new_state FROM admin_audit_log WHERE entity_type = 'USER' AND entity_id = ? AND action = 'OPERATOR_CREATED'")
      .get(id) as { new_state: string };
    expect(audit.new_state.includes('password_hash')).toBe(false);
    expect(audit.new_state.includes(email)).toBe(true);
  });

  it('moves operators between sites but never into disabled ones', async () => {
    const email = uniqueEmail('op3');
    const created = await adminReq('post', '/warehouse-users').send({
      email,
      password: 'Operator123',
      fullName: 'Moving Operator',
      warehouseId: DEFAULT_WAREHOUSE_ID,
    });
    const id = (created.body as { user: { id: string } }).user.id;

    const site = await adminReq('post', '/warehouses').send({ code: `TST-D-${Date.now() % 100000}`, name: 'Dark Hub', city: 'X' });
    const darkId = (site.body as { warehouse: { id: string } }).warehouse.id;
    expect((await adminReq('patch', `/warehouses/${darkId}`).send({ active: false })).status).toBe(200);

    const bad = await adminReq('patch', `/warehouse-users/${id}`).send({ warehouseId: darkId });
    expect(bad.status).toBe(422);
    expect((bad.body as { code: string }).code).toBe('WAREHOUSE_DISABLED');

    const moved = await adminReq('patch', `/warehouse-users/${id}`).send({ warehouseId: siteId });
    expect(moved.status).toBe(200);
    expect((moved.body as { user: { warehouse_id: string } }).user.warehouse_id).toBe(siteId);

    const customerPatch = await adminReq('patch', `/warehouse-users/${customer.user.id}`).send({ active: false });
    expect(customerPatch.status).toBe(422);
    expect((customerPatch.body as { code: string }).code).toBe('OPERATOR_INVALID_ROLE');
  });

  it('refuses to disable an operator holding open work, naming it', async () => {
    const task = createTask({
      warehouseId: siteId,
      kind: 'INSPECT_ITEM',
      title: 'Held inspection proof',
      returnId: null,
    });
    await wh(operatorToken, 'patch', `/tasks/${task.id}`).send({ assignedTo: operatorId });

    const res = await adminReq('patch', `/warehouse-users/${operatorId}`).send({ active: false });
    expect(res.status).toBe(409);
    const body = res.body as {
      code: string;
      errors: { assignedOpenTasks: number; taskTitles: string[] };
    };
    expect(body.code).toBe('OPERATOR_HAS_OPEN_WORK');
    expect(body.errors.assignedOpenTasks).toBe(1);
    expect(body.errors.taskTitles).toContain('Held inspection proof');

    await wh(operatorToken, 'patch', `/tasks/${task.id}`).send({ status: 'COMPLETED' });
    expect((await adminReq('patch', `/warehouse-users/${operatorId}`).send({ active: false })).status).toBe(200);

    // Disabled accounts stop at login and at every bearer call.
    const relogin = await loginAs(opEmail, 'Operator123');
    expect(relogin.status).toBe(403);
    expect((relogin.body as { code: string }).code).toBe('ACCOUNT_DISABLED');
    const blockedCall = await wh(operatorToken, 'get', '/returns');
    expect(blockedCall.status).toBe(403);
    expect((blockedCall.body as { code: string }).code).toBe('ACCOUNT_DISABLED');
  });

  it('re-enabling restores a disabled operator', async () => {
    expect((await adminReq('patch', `/warehouse-users/${operatorId}`).send({ active: true })).status).toBe(200);
    expect((await wh(operatorToken, 'get', '/returns')).status).toBe(200);
  });

  it('fences lifecycle writes off from customers', async () => {
    const res = await request(app)
      .post('/api/v1/admin/warehouses')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ code: 'X', name: 'Y' });
    expect(res.status).toBe(403);
  });
});
