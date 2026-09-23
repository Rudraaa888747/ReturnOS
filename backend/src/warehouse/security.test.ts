import { beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { app } from '../app.js';
import { db, initSchema } from '../db.js';
import { seedDatabase } from '../seed.js';
import { createOrder } from '../store.js';

/**
 * Phase 7 — explicit authorization matrix and cross-warehouse isolation.
 *
 * Every endpoint rejects anonymous callers (401), customers get 403 on the
 * floor API and operators get 403 on the customer API, and one site cannot
 * see or touch another site's received work (404, identical to missing, so
 * ids cannot be probed). Unreceived arrivals stay a shared board: any dock
 * may receive the parcel in front of it.
 */

interface Session {
  token: string;
  user: { id: string };
}

const WAREHOUSE_LOGIN = { email: 'warehouse@returnos.test', password: 'Warehouse123' };

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

async function loginWarehouse(): Promise<Session> {
  const res = await request(app).post('/api/v1/auth/login').send(WAREHOUSE_LOGIN);
  expect(res.status).toBe(200);
  return res.body as Session;
}

/** A second site with its own operator, for probing cross-warehouse isolation. */
async function loginFarWarehouse(): Promise<Session> {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO warehouses (id, code, name, city, active, created_at, updated_at)
     VALUES ('wh-far', 'FAR-01', 'Far Hub', 'Delhi', 1, ?, ?)`,
  ).run(now, now);
  const hash = bcrypt.hashSync('Far12345', 10);
  db.prepare(
    `INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role, warehouse_id, created_at)
     VALUES ('u-wh-far', 'far@returnos.test', ?, 'Far Operator', 'WAREHOUSE', 'wh-far', ?)`,
  ).run(hash, now);
  const res = await request(app).post('/api/v1/auth/login').send({ email: 'far@returnos.test', password: 'Far12345' });
  expect(res.status).toBe(200);
  return res.body as Session;
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** A delivered order for `customerId` containing one catalogue product. */
function deliveredOrder(customerId: string, suffix: string) {
  const product = db.prepare('SELECT sku, name, price_paise FROM products WHERE id = ?').get('p-tee') as {
    sku: string;
    name: string;
    price_paise: number;
  };
  return createOrder({
    orderNumber: `ORD-SEC-${suffix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
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

/** Create a return through the customer API, the way a real one arrives. */
async function createReturnVia(
  customer: Session,
  orderId: string,
  resolutionType = 'REFUND',
): Promise<{ returnId: string; returnItemId: string }> {
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

function wh(token: string | null, method: 'get' | 'post' | 'patch', path: string) {
  const req = request(app)[method](`/api/v1/warehouse${path}`);
  return token === null ? req : req.set('Authorization', `Bearer ${token}`);
}

let warehouse: Session;
let farWarehouse: Session;
let customer: Session;

beforeAll(async () => {
  initSchema();
  seedDatabase();
  warehouse = await loginWarehouse();
  farWarehouse = await loginFarWarehouse();
  customer = await signupCustomer('sec');
});

describe('anonymous callers are rejected everywhere on the floor', () => {
  const probes: Array<{ method: 'get' | 'post' | 'patch'; path: string; body?: unknown }> = [
    { method: 'get', path: '/me' },
    { method: 'get', path: '/summary' },
    { method: 'get', path: '/returns' },
    { method: 'get', path: '/returns/r-nope' },
    { method: 'get', path: '/tasks' },
    { method: 'get', path: '/inventory' },
    { method: 'get', path: '/inventory-movements' },
    { method: 'get', path: '/shipments' },
    { method: 'get', path: '/analytics' },
    { method: 'get', path: '/audit' },
    { method: 'post', path: '/returns/r-nope/approve', body: {} },
    { method: 'post', path: '/returns/r-nope/receive', body: { packageCondition: 'SEALED', receivedQuantity: 1 } },
    { method: 'post', path: '/returns/r-nope/inspection/start', body: {} },
    { method: 'post', path: '/returns/r-nope/inspection/complete', body: { findings: [] } },
    { method: 'post', path: '/returns/r-nope/disposition', body: { returnItemId: 'x', action: 'RESTOCK', quantity: 1 } },
    { method: 'patch', path: '/tasks/t-nope', body: { priority: 'URGENT' } },
    { method: 'post', path: '/tasks/t-nope/claim', body: {} },
  ];

  for (const probe of probes) {
    it(`401 on ${probe.method.toUpperCase()} ${probe.path} without a token`, async () => {
      const res = await wh(null, probe.method, probe.path).send(probe.body ?? {});
      expect(res.status).toBe(401);
    });
  }

  it('401 on a forged token', async () => {
    const res = await request(app).get('/api/v1/warehouse/returns').set('Authorization', 'Bearer not-a-token');
    expect(res.status).toBe(401);
  });
});

describe('customers are fenced off the floor, operators off the shop', () => {
  it('rejects every warehouse mutation for a customer with 403', async () => {
    const order = deliveredOrder(customer.user.id, `fence-${Date.now()}`);
    const { returnId } = await createReturnVia(customer, order.id);
    const probes: Array<{ method: 'get' | 'post' | 'patch'; path: string; body?: unknown }> = [
      { method: 'get', path: '/returns' },
      { method: 'get', path: `/returns/${returnId}` },
      { method: 'post', path: `/returns/${returnId}/approve`, body: {} },
      { method: 'post', path: `/returns/${returnId}/receive`, body: { packageCondition: 'SEALED', receivedQuantity: 1 } },
      { method: 'post', path: `/returns/${returnId}/inspection/start`, body: {} },
      { method: 'get', path: '/tasks' },
      { method: 'get', path: '/inventory' },
      { method: 'get', path: '/shipments' },
      { method: 'get', path: '/analytics' },
      { method: 'get', path: '/audit' },
      { method: 'get', path: '/summary' },
    ];
    for (const probe of probes) {
      const res = await wh(customer.token, probe.method, probe.path).send(probe.body ?? {});
      expect(res.status, `${probe.method} ${probe.path} should be forbidden for customers`).toBe(403);
    }
  });

  it('rejects shop writes for a warehouse operator with 403', async () => {
    const probes: Array<{ method: 'get' | 'post' | 'patch'; path: string; body?: unknown }> = [
      { method: 'post', path: '/returns', body: {} },
      { method: 'post', path: '/cart', body: { productId: 'p-tee', quantity: 1 } },
      { method: 'get', path: '/credit' },
      { method: 'post', path: '/checkout', body: {} },
    ];
    for (const probe of probes) {
      const res = await request(app)
        [probe.method](`/api/v1${probe.path}`)
        .set('Authorization', `Bearer ${warehouse.token}`)
        .send(probe.body ?? {});
      expect(res.status, `${probe.method} ${probe.path} should be forbidden for operators`).toBe(403);
    }
  });
});

describe('cross-warehouse isolation', () => {
  it('keeps unreceived arrivals on the shared board for every dock', async () => {
    const order = deliveredOrder(customer.user.id, `shared-${Date.now()}`);
    const { returnId } = await createReturnVia(customer, order.id);
    const number = (db.prepare('SELECT return_number FROM returns WHERE id = ?').get(returnId) as { return_number: string }).return_number;

    const res = await wh(farWarehouse.token, 'get', '/returns?status=REQUESTED');
    expect(res.status).toBe(200);
    const numbers = ((res.body as { returns: Array<{ returnNumber: string }> }).returns).map((row) => row.returnNumber);
    expect(numbers).toContain(number);
  });

  it('lets the dock holding the parcel receive it first', async () => {
    const order = deliveredOrder(customer.user.id, `dock-${Date.now()}`);
    const { returnId } = await createReturnVia(customer, order.id);

    const res = await wh(farWarehouse.token, 'post', `/returns/${returnId}/receive`).send({
      packageCondition: 'SEALED',
      receivedQuantity: 1,
    });
    expect(res.status).toBe(201);
    const site = db.prepare('SELECT warehouse_id FROM receiving_records WHERE return_id = ?').get(returnId) as {
      warehouse_id: string;
    };
    expect(site.warehouse_id).toBe('wh-far');
  });

  it('hides another dock received work behind the same 404 as a missing return', async () => {
    const order = deliveredOrder(customer.user.id, `foreign-${Date.now()}`);
    const { returnId, returnItemId } = await createReturnVia(customer, order.id);
    await wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/receive`).send({
      packageCondition: 'SEALED',
      receivedQuantity: 1,
    });

    const read = await wh(farWarehouse.token, 'get', `/returns/${returnId}`);
    expect(read.status).toBe(404);
    expect((read.body as { code: string }).code).toBe('RETURN_NOT_FOUND');

    const list = await wh(farWarehouse.token, 'get', '/returns?status=RECEIVED');
    expect(list.status).toBe(200);
    const ids = ((list.body as { returns: Array<{ returnId: string }> }).returns).map((row) => row.returnId);
    expect(ids).not.toContain(returnId);

    const approve = await wh(farWarehouse.token, 'post', `/returns/${returnId}/approve`).send({});
    expect(approve.status).toBe(404);

    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/start`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/complete`).send({
      findings: [
        { returnItemId, result: 'PASS', productCondition: 'LIKE_NEW', packagingCondition: 'NEW', quantity: 1 },
      ],
    });
    const dispose = await wh(farWarehouse.token, 'post', `/returns/${returnId}/disposition`).send({
      returnItemId,
      action: 'RESTOCK',
      quantity: 1,
    });
    expect(dispose.status).toBe(404);
    expect((dispose.body as { code: string }).code).toBe('RETURN_NOT_FOUND');
  });
});
