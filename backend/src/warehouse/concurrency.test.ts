import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db, initSchema } from '../db.js';
import { seedDatabase } from '../seed.js';
import { createOrder } from '../store.js';
import { syncAvailableBuckets } from './inventory.js';
import { DEFAULT_WAREHOUSE_ID } from './schema.js';

/**
 * Phase 7 — races and retried submissions.
 *
 * better-sqlite3 is synchronous, so each transaction lands whole: parallel
 * HTTP requests serialize at the driver and exactly one of them wins. These
 * tests pin that property where money or goods move — double receipts,
 * double approvals, double dispositions, double inspection completions, and
 * two checkouts racing the last sellable unit.
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

async function createAddress(token: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/addresses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName: 'Race Buyer',
      line1: '10 Market Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
    });
  expect(res.status).toBe(201);
  return (res.body as { address: { id: string } }).address.id;
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
    orderNumber: `ORD-RACE-${suffix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
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
      resolutionType: 'REFUND',
      pickupKind: 'PICKUP',
      pickupAddress: 'Home',
    });
  expect(res.status).toBe(201);
  const returnId = (res.body as { ret: { id: string } }).ret.id;
  const item = db.prepare('SELECT id FROM return_items WHERE return_id = ?').get(returnId) as { id: string };
  return { returnId, returnItemId: item.id };
}

function wh(token: string, method: 'get' | 'post' | 'patch', path: string) {
  return request(app)[method](`/api/v1/warehouse${path}`).set('Authorization', `Bearer ${token}`);
}

let warehouse: Session;

beforeAll(async () => {
  initSchema();
  seedDatabase();
  warehouse = await loginWarehouse();
});

describe('parallel submissions serialize: exactly one wins', () => {
  it('two simultaneous receipts record a single receiving row', async () => {
    const customer = await signupCustomer('race-rcv');
    const order = deliveredOrder(customer.user.id, `rcv-${Date.now()}`);
    const { returnId } = await createReturnVia(customer, order.id);

    const [first, second] = await Promise.all([
      wh(warehouse.token, 'post', `/returns/${returnId}/receive`).send({
        packageCondition: 'SEALED',
        receivedQuantity: 1,
      }),
      wh(warehouse.token, 'post', `/returns/${returnId}/receive`).send({
        packageCondition: 'SEALED',
        receivedQuantity: 1,
      }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = first.status === 201 ? second : first;
    expect((loser.body as { code: string }).code).toBe('ALREADY_RECEIVED');

    const records = db.prepare('SELECT COUNT(*) AS count FROM receiving_records WHERE return_id = ?').get(returnId) as {
      count: number;
    };
    expect(records.count).toBe(1);
  });

  it('two simultaneous approvals approve exactly once', async () => {
    const customer = await signupCustomer('race-appr');
    const order = deliveredOrder(customer.user.id, `appr-${Date.now()}`);
    const { returnId } = await createReturnVia(customer, order.id);

    const [first, second] = await Promise.all([
      wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({}),
      wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({}),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = first.status === 200 ? second : first;
    expect((loser.body as { code: string }).code).toBe('ALREADY_APPROVED');
  });

  it('two simultaneous dispositions record a single line outcome', async () => {
    const customer = await signupCustomer('race-disp');
    const order = deliveredOrder(customer.user.id, `disp-${Date.now()}`);
    const { returnId, returnItemId } = await createReturnVia(customer, order.id);
    await wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/receive`).send({
      packageCondition: 'SEALED',
      receivedQuantity: 1,
    });
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/start`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/complete`).send({
      findings: [
        { returnItemId, result: 'PASS', productCondition: 'LIKE_NEW', packagingCondition: 'NEW', quantity: 1 },
      ],
    });

    const [first, second] = await Promise.all([
      wh(warehouse.token, 'post', `/returns/${returnId}/disposition`).send({
        returnItemId,
        action: 'RESTOCK',
        quantity: 1,
      }),
      wh(warehouse.token, 'post', `/returns/${returnId}/disposition`).send({
        returnItemId,
        action: 'RESTOCK',
        quantity: 1,
      }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = first.status === 201 ? second : first;
    expect((loser.body as { code: string }).code).toBe('ALREADY_DISPOSED');

    const rows = db.prepare('SELECT COUNT(*) AS count FROM dispositions WHERE return_item_id = ?').get(returnItemId) as {
      count: number;
    };
    expect(rows.count).toBe(1);
  });

  it('two checkouts racing the last unit sell it exactly once', async () => {
    const buyerA = await signupCustomer('race-buy-a');
    const buyerB = await signupCustomer('race-buy-b');
    const addressA = await createAddress(buyerA.token);
    const addressB = await createAddress(buyerB.token);

    db.prepare('UPDATE products SET stock = 1 WHERE id = ?').run('p-tee');
    syncAvailableBuckets(DEFAULT_WAREHOUSE_ID);

    for (const buyer of [buyerA, buyerB]) {
      const added = await request(app)
        .post('/api/v1/cart')
        .set('Authorization', `Bearer ${buyer.token}`)
        .send({ productId: 'p-tee', quantity: 1 });
      expect(added.status).toBe(201);
    }

    const [resA, resB] = await Promise.all([
      request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${buyerA.token}`)
        .send({ addressId: addressA, useStoreCredit: false, idempotencyKey: `race-a-${Date.now()}` }),
      request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${buyerB.token}`)
        .send({ addressId: addressB, useStoreCredit: false, idempotencyKey: `race-b-${Date.now()}` }),
    ]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = resA.status === 201 ? resB : resA;
    expect((loser.body as { code: string }).code).toBe('INSUFFICIENT_STOCK');

    const stock = db.prepare('SELECT stock FROM products WHERE id = ?').get('p-tee') as { stock: number };
    expect(stock.stock).toBe(0);
  });
});

describe('retried submissions never stack', () => {
  it('starting an inspection twice returns the same inspection', async () => {
    const customer = await signupCustomer('race-insp');
    const order = deliveredOrder(customer.user.id, `insp-${Date.now()}`);
    const { returnId } = await createReturnVia(customer, order.id);
    await wh(warehouse.token, 'post', `/returns/${returnId}/receive`).send({
      packageCondition: 'SEALED',
      receivedQuantity: 1,
    });

    const first = await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/start`).send({});
    const second = await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/start`).send({});
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((second.body as { inspection: { id: string } }).inspection.id).toBe(
      (first.body as { inspection: { id: string } }).inspection.id,
    );
  });

  it('completing an inspection twice is rejected the second time', async () => {
    const customer = await signupCustomer('race-comp');
    const order = deliveredOrder(customer.user.id, `comp-${Date.now()}`);
    const { returnId, returnItemId } = await createReturnVia(customer, order.id);
    await wh(warehouse.token, 'post', `/returns/${returnId}/receive`).send({
      packageCondition: 'SEALED',
      receivedQuantity: 1,
    });
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/start`).send({});
    const findings = {
      findings: [
        { returnItemId, result: 'PASS', productCondition: 'LIKE_NEW', packagingCondition: 'NEW', quantity: 1 },
      ],
    };

    const first = await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/complete`).send(findings);
    expect(first.status).toBe(200);
    const second = await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/complete`).send(findings);
    expect(second.status).toBe(409);
    expect((second.body as { code: string }).code).toBe('INSPECTION_COMPLETED');
  });

  it('receiving a cancelled return stays refused', async () => {
    const customer = await signupCustomer('race-cancel');
    const order = deliveredOrder(customer.user.id, `cancel-${Date.now()}`);
    const { returnId } = await createReturnVia(customer, order.id);

    const cancelled = await request(app)
      .post(`/api/v1/returns/${returnId}/cancel`)
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ reason: 'Changed my mind about returning' });
    expect(cancelled.status).toBe(200);

    const res = await wh(warehouse.token, 'post', `/returns/${returnId}/receive`).send({
      packageCondition: 'SEALED',
      receivedQuantity: 1,
    });
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('RETURN_CANCELLED');
  });
});
