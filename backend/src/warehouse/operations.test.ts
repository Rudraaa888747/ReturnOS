import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db, initSchema } from '../db.js';
import { seedDatabase } from '../seed.js';
import { createOrder, creditBalance } from '../store.js';
import { applyMovement, bucketQuantity, consumeAvailableStock, syncAvailableBuckets } from './inventory.js';
import { DEFAULT_WAREHOUSE_ID } from './schema.js';

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

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** A delivered order for `customerId` containing one catalogue product. */
function deliveredOrder(customerId: string, suffix: string, productId = 'p-tee', quantity = 1) {
  const product = db.prepare('SELECT sku, name, price_paise FROM products WHERE id = ?').get(productId) as {
    sku: string;
    name: string;
    price_paise: number;
  };
  return createOrder({
    orderNumber: `ORD-WH-${suffix}`,
    customerId,
    status: 'DELIVERED',
    createdAt: daysAgoIso(5),
    deliveredAt: daysAgoIso(2),
    items: [
      {
        productId,
        sku: product.sku,
        productName: product.name,
        quantity,
        unitPrice: product.price_paise / 100,
      },
    ],
  });
}

/** Create a return through the customer API, the way a real one arrives. */
async function createReturnVia(
  customer: Session,
  orderId: string,
  resolutionType: string,
  reasonCode = 'CHANGED_MIND',
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
      items: [{ orderItemId, quantity: 1, reasonCode }],
      resolutionType,
      pickupKind: 'PICKUP',
      pickupAddress: 'Home',
    });
  expect(res.status).toBe(201);
  const returnId = (res.body as { ret: { id: string } }).ret.id;
  const item = db.prepare('SELECT id FROM return_items WHERE return_id = ?').get(returnId) as { id: string };
  return { returnId, returnItemId: item.id };
}

function wh(token: string, method: 'get' | 'post', path: string) {
  return request(app)[method](`/api/v1/warehouse${path}`).set('Authorization', `Bearer ${token}`);
}

let warehouse: Session;
let customer: Session;

beforeAll(async () => {
  initSchema();
  seedDatabase();
  warehouse = await loginWarehouse();
  customer = await signupCustomer('wh');
});

describe('warehouse authorization', () => {
  it('rejects unauthenticated access', async () => {
    const res = await request(app).get('/api/v1/warehouse/returns');
    expect(res.status).toBe(401);
  });

  it('rejects a customer with 403, not 404', async () => {
    const res = await wh(customer.token, 'get', '/returns');
    expect(res.status).toBe(403);
    expect((res.body as { code: string }).code).toBe('FORBIDDEN');
  });

  it('blocks a warehouse operator from the customer API', async () => {
    for (const path of ['/api/v1/orders', '/api/v1/returns', '/api/v1/cart', '/api/v1/credit']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${warehouse.token}`);
      expect(res.status, `${path} should be forbidden for warehouse`).toBe(403);
    }
  });

  it('scopes the operator to their assigned warehouse', async () => {
    const res = await wh(warehouse.token, 'get', '/me');
    expect(res.status).toBe(200);
    expect((res.body as { warehouse: { id: string } }).warehouse.id).toBe(DEFAULT_WAREHOUSE_ID);
  });

  it('refuses a location belonging to another warehouse', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO warehouses (id, code, name, city, active, created_at, updated_at)
       VALUES ('wh-other', 'OTH-01', 'Other Hub', 'Pune', 1, ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT OR IGNORE INTO warehouse_locations (id, warehouse_id, code, name, kind, active, created_at)
       VALUES ('loc-other-rcv', 'wh-other', 'RCV-01', 'Other dock', 'RECEIVING', 1, ?)`,
    ).run(now);

    const order = deliveredOrder(customer.user.id, `loc-${Date.now()}`);
    const { returnId } = await createReturnVia(customer, order.id, 'REFUND');
    const res = await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'SEALED', receivedQuantity: 1, locationId: 'loc-other-rcv' });
    expect(res.status).toBe(404);
    expect((res.body as { code: string }).code).toBe('LOCATION_NOT_FOUND');
  });
});

describe('receiving', () => {
  it('receives a parcel, advances the return, and tells the customer', async () => {
    const order = deliveredOrder(customer.user.id, `rcv-${Date.now()}`);
    const { returnId } = await createReturnVia(customer, order.id, 'REFUND');

    const res = await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'SEALED', receivedQuantity: 1, notes: 'Box intact' });
    expect(res.status).toBe(201);
    expect((res.body as { ret: { status: string } }).ret.status).toBe('RECEIVED');

    // The customer sees it through the shared timeline, not a pushed update.
    const timeline = await request(app)
      .get(`/api/v1/returns/${returnId}/timeline`)
      .set('Authorization', `Bearer ${customer.token}`);
    const statuses = (timeline.body as { events: Array<{ status: string }> }).events.map((e) => e.status);
    expect(statuses).toContain('RECEIVED');

    // Goods are booked into the RETURNED state.
    expect(bucketQuantity(DEFAULT_WAREHOUSE_ID, 'p-tee', 'RETURNED')).toBeGreaterThan(0);
  });

  it('refuses a second receipt of the same parcel', async () => {
    const order = deliveredOrder(customer.user.id, `dup-${Date.now()}`);
    const { returnId } = await createReturnVia(customer, order.id, 'REFUND');

    const first = await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'SEALED', receivedQuantity: 1 });
    expect(first.status).toBe(201);

    const second = await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'SEALED', receivedQuantity: 1 });
    expect(second.status).toBe(409);
    expect((second.body as { code: string }).code).toBe('ALREADY_RECEIVED');

    const records = db.prepare('SELECT COUNT(*) AS count FROM receiving_records WHERE return_id = ?').get(returnId) as {
      count: number;
    };
    expect(records.count).toBe(1);
  });

  it('will not accept a short count without a recorded discrepancy', async () => {
    const order = deliveredOrder(customer.user.id, `short-${Date.now()}`, 'p-tee', 2);
    const detail = await request(app)
      .get(`/api/v1/orders/${order.id}`)
      .set('Authorization', `Bearer ${customer.token}`);
    const orderItemId = (detail.body as { items: Array<{ id: string }> }).items[0].id;
    const created = await request(app)
      .post('/api/v1/returns')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        orderId: order.id,
        items: [{ orderItemId, quantity: 2, reasonCode: 'CHANGED_MIND' }],
        resolutionType: 'REFUND',
        pickupKind: 'PICKUP',
        pickupAddress: 'Home',
      });
    const returnId = (created.body as { ret: { id: string } }).ret.id;

    const short = await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'OPENED', receivedQuantity: 1 });
    expect(short.status).toBe(422);
    expect((short.body as { code: string }).code).toBe('DISCREPANCY_REQUIRED');

    const recorded = await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'OPENED', receivedQuantity: 1, discrepancy: 'QUANTITY_MISMATCH' });
    expect(recorded.status).toBe(201);
  });

  it('rejects more units than were returned', async () => {
    const order = deliveredOrder(customer.user.id, `over-${Date.now()}`);
    const { returnId } = await createReturnVia(customer, order.id, 'REFUND');
    const res = await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'SEALED', receivedQuantity: 9 });
    expect(res.status).toBe(422);
    expect((res.body as { code: string }).code).toBe('QUANTITY_EXCEEDS_EXPECTED');
  });
});

describe('workflow ordering', () => {
  it('will not inspect a return that has not been received', async () => {
    const order = deliveredOrder(customer.user.id, `order-${Date.now()}`);
    const { returnId } = await createReturnVia(customer, order.id, 'REFUND');
    const res = await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/start`).send({});
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('NOT_RECEIVED');
  });

  it('will not dispose before the inspection is complete', async () => {
    const order = deliveredOrder(customer.user.id, `disp-${Date.now()}`);
    const { returnId, returnItemId } = await createReturnVia(customer, order.id, 'REFUND');
    // Approval is a separate decision from receiving; without it the payout
    // below would be held back.
    await wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'SEALED', receivedQuantity: 1 });
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/start`).send({});

    const res = await wh(warehouse.token, 'post', `/returns/${returnId}/disposition`)
      .send({ returnItemId, action: 'RESTOCK', quantity: 1 });
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('INSPECTION_INCOMPLETE');
  });

  it('refuses a disposition the inspection result does not permit', async () => {
    const order = deliveredOrder(customer.user.id, `notallowed-${Date.now()}`);
    const { returnId, returnItemId } = await createReturnVia(customer, order.id, 'REFUND');
    // Approval is a separate decision from receiving; without it the payout
    // below would be held back.
    await wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'SEALED', receivedQuantity: 1 });
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/start`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/complete`).send({
      findings: [
        {
          returnItemId,
          result: 'UNSELLABLE',
          productCondition: 'UNUSABLE',
          packagingCondition: 'DAMAGED',
          quantity: 1,
        },
      ],
    });

    // Unsellable goods cannot go back on the shelf.
    const res = await wh(warehouse.token, 'post', `/returns/${returnId}/disposition`)
      .send({ returnItemId, action: 'RESTOCK', quantity: 1 });
    expect(res.status).toBe(422);
    expect((res.body as { code: string }).code).toBe('DISPOSITION_NOT_ALLOWED');
  });

  it('refuses a second disposition for the same line', async () => {
    const order = deliveredOrder(customer.user.id, `twice-${Date.now()}`);
    const { returnId, returnItemId } = await createReturnVia(customer, order.id, 'REFUND');
    // Approval is a separate decision from receiving; without it the payout
    // below would be held back.
    await wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'SEALED', receivedQuantity: 1 });
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/start`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/complete`).send({
      findings: [
        { returnItemId, result: 'PASS', productCondition: 'LIKE_NEW', packagingCondition: 'NEW', quantity: 1 },
      ],
    });

    const first = await wh(warehouse.token, 'post', `/returns/${returnId}/disposition`)
      .send({ returnItemId, action: 'RESTOCK', quantity: 1 });
    expect(first.status).toBe(201);

    const second = await wh(warehouse.token, 'post', `/returns/${returnId}/disposition`)
      .send({ returnItemId, action: 'RESTOCK', quantity: 1 });
    expect(second.status).toBe(409);
    expect((second.body as { code: string }).code).toBe('ALREADY_DISPOSED');
  });
});

describe('disposition delegates the financial outcome', () => {
  it('issues store credit exactly once through the shared resolution engine', async () => {
    const order = deliveredOrder(customer.user.id, `credit-${Date.now()}`);
    const { returnId, returnItemId } = await createReturnVia(customer, order.id, 'STORE_CREDIT');
    const before = creditBalance(customer.user.id);

    // Approval is a separate decision from receiving; without it the payout
    // below would be held back.
    await wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'SEALED', receivedQuantity: 1 });
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/start`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/complete`).send({
      findings: [
        { returnItemId, result: 'PASS', productCondition: 'LIKE_NEW', packagingCondition: 'NEW', quantity: 1 },
      ],
    });

    // No credit until the goods are actually dispositioned.
    expect(creditBalance(customer.user.id)).toBe(before);

    const res = await wh(warehouse.token, 'post', `/returns/${returnId}/disposition`)
      .send({ returnItemId, action: 'RESTOCK', quantity: 1 });
    expect(res.status).toBe(201);
    expect((res.body as { returnResolved: boolean }).returnResolved).toBe(true);

    const ledger = db
      .prepare("SELECT amount_paise FROM store_credit_ledger WHERE reference_type = 'RETURN' AND reference_id = ?")
      .all(returnId) as Array<{ amount_paise: number }>;
    expect(ledger).toHaveLength(1);
    expect(creditBalance(customer.user.id)).toBe(before + ledger[0].amount_paise);

    // The customer sees the resolution on the shared timeline.
    const detail = await request(app)
      .get(`/api/v1/returns/${returnId}`)
      .set('Authorization', `Bearer ${customer.token}`);
    expect((detail.body as { ret: { status: string } }).ret.status).toBe('RESOLVED');
  });

  it('does not issue store credit for a refund resolution', async () => {
    const order = deliveredOrder(customer.user.id, `refund-${Date.now()}`);
    const { returnId, returnItemId } = await createReturnVia(customer, order.id, 'REFUND');
    const before = creditBalance(customer.user.id);

    // Approval is a separate decision from receiving; without it the payout
    // below would be held back.
    await wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'SEALED', receivedQuantity: 1 });
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/start`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/complete`).send({
      findings: [
        { returnItemId, result: 'PASS', productCondition: 'LIKE_NEW', packagingCondition: 'NEW', quantity: 1 },
      ],
    });
    await wh(warehouse.token, 'post', `/returns/${returnId}/disposition`)
      .send({ returnItemId, action: 'RESTOCK', quantity: 1 });

    expect(creditBalance(customer.user.id)).toBe(before);
    const refund = db.prepare('SELECT status FROM refunds WHERE return_id = ?').get(returnId) as { status: string };
    expect(refund.status).toBe('COMPLETED');
  });
});

describe('inventory never drifts from the sellable stock count', () => {
  /** products.stock and the AVAILABLE bucket must always agree. */
  function assertAligned(productId: string): void {
    const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(productId) as { stock: number };
    const bucket = bucketQuantity(DEFAULT_WAREHOUSE_ID, productId, 'AVAILABLE');
    expect(bucket, `AVAILABLE bucket should equal products.stock for ${productId}`).toBe(product.stock);
  }

  it('keeps a restock and a sale aligned when they interleave', () => {
    const productId = 'p-denim';
    syncAvailableBuckets(DEFAULT_WAREHOUSE_ID);
    assertAligned(productId);

    const start = (db.prepare('SELECT stock FROM products WHERE id = ?').get(productId) as { stock: number }).stock;

    // Interleave restocks and sales the way two operators would.
    for (let round = 0; round < 10; round += 1) {
      applyMovement({
        warehouseId: DEFAULT_WAREHOUSE_ID,
        productId,
        quantity: 2,
        fromState: null,
        toState: 'AVAILABLE',
        reason: 'RESTOCK',
        referenceType: 'TEST_RESTOCK',
        referenceId: `drift-${round}`,
      });
      assertAligned(productId);

      const sold = consumeAvailableStock({
        warehouseId: DEFAULT_WAREHOUSE_ID,
        productId,
        quantity: 1,
        orderId: `drift-order-${round}`,
      });
      expect(sold).toBe(true);
      assertAligned(productId);
    }

    // 10 restocks of 2 minus 10 sales of 1.
    const end = (db.prepare('SELECT stock FROM products WHERE id = ?').get(productId) as { stock: number }).stock;
    expect(end).toBe(start + 10);
    assertAligned(productId);
  });

  it('rolls back both writes when a movement fails partway', () => {
    const productId = 'p-aurora';
    syncAvailableBuckets(DEFAULT_WAREHOUSE_ID);
    const before = (db.prepare('SELECT stock FROM products WHERE id = ?').get(productId) as { stock: number }).stock;
    const bucketBefore = bucketQuantity(DEFAULT_WAREHOUSE_ID, productId, 'AVAILABLE');

    // More units than the DAMAGED bucket holds: the debit must fail, and the
    // AVAILABLE credit and products.stock bump must not survive it.
    expect(() =>
      applyMovement({
        warehouseId: DEFAULT_WAREHOUSE_ID,
        productId,
        quantity: 5,
        fromState: 'DAMAGED',
        toState: 'AVAILABLE',
        reason: 'RESTOCK',
        referenceType: 'TEST_ROLLBACK',
        referenceId: `rollback-${Date.now()}`,
      }),
    ).toThrow(/Not enough stock/);

    expect((db.prepare('SELECT stock FROM products WHERE id = ?').get(productId) as { stock: number }).stock).toBe(before);
    expect(bucketQuantity(DEFAULT_WAREHOUSE_ID, productId, 'AVAILABLE')).toBe(bucketBefore);
    assertAligned(productId);
  });

  it('treats a replayed movement as a no-op rather than a second movement', () => {
    const productId = 'p-trail';
    syncAvailableBuckets(DEFAULT_WAREHOUSE_ID);
    const before = (db.prepare('SELECT stock FROM products WHERE id = ?').get(productId) as { stock: number }).stock;

    const reference = `replay-${Date.now()}`;
    const first = applyMovement({
      warehouseId: DEFAULT_WAREHOUSE_ID,
      productId,
      quantity: 3,
      fromState: null,
      toState: 'AVAILABLE',
      reason: 'RESTOCK',
      referenceType: 'TEST_REPLAY',
      referenceId: reference,
    });
    expect(first).not.toBeNull();

    const replay = applyMovement({
      warehouseId: DEFAULT_WAREHOUSE_ID,
      productId,
      quantity: 3,
      fromState: null,
      toState: 'AVAILABLE',
      reason: 'RESTOCK',
      referenceType: 'TEST_REPLAY',
      referenceId: reference,
    });
    expect(replay).toBeNull();

    const after = (db.prepare('SELECT stock FROM products WHERE id = ?').get(productId) as { stock: number }).stock;
    expect(after).toBe(before + 3);
    assertAligned(productId);
  });

  it('restocking through disposition raises the sellable count', async () => {
    const order = deliveredOrder(customer.user.id, `restock-${Date.now()}`, 'p-tee');
    const { returnId, returnItemId } = await createReturnVia(customer, order.id, 'REFUND');
    const before = (db.prepare("SELECT stock FROM products WHERE id = 'p-tee'").get() as { stock: number }).stock;

    // Approval is a separate decision from receiving; without it the payout
    // below would be held back.
    await wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'SEALED', receivedQuantity: 1 });
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/start`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/complete`).send({
      findings: [
        { returnItemId, result: 'PASS', productCondition: 'NEW', packagingCondition: 'NEW', quantity: 1 },
      ],
    });
    await wh(warehouse.token, 'post', `/returns/${returnId}/disposition`)
      .send({ returnItemId, action: 'RESTOCK', quantity: 1 });

    const after = (db.prepare("SELECT stock FROM products WHERE id = 'p-tee'").get() as { stock: number }).stock;
    expect(after).toBe(before + 1);
  });

  it('scrapping does not raise the sellable count', async () => {
    const order = deliveredOrder(customer.user.id, `scrap-${Date.now()}`, 'p-tee');
    const { returnId, returnItemId } = await createReturnVia(customer, order.id, 'REFUND', 'DEFECTIVE');
    const before = (db.prepare("SELECT stock FROM products WHERE id = 'p-tee'").get() as { stock: number }).stock;

    await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'DAMAGED', receivedQuantity: 1, discrepancy: 'DAMAGED_PACKAGE' });
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/start`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/complete`).send({
      findings: [
        { returnItemId, result: 'DEFECTIVE', productCondition: 'UNUSABLE', packagingCondition: 'DAMAGED', quantity: 1 },
      ],
    });
    const res = await wh(warehouse.token, 'post', `/returns/${returnId}/disposition`)
      .send({ returnItemId, action: 'DISPOSE', quantity: 1, reason: 'Beyond repair' });
    expect(res.status).toBe(201);

    const after = (db.prepare("SELECT stock FROM products WHERE id = 'p-tee'").get() as { stock: number }).stock;
    expect(after).toBe(before);
    expect(bucketQuantity(DEFAULT_WAREHOUSE_ID, 'p-tee', 'DISPOSAL')).toBeGreaterThan(0);
  });
});

describe('audit trail', () => {
  it('records each operational step and exposes no way to alter it', async () => {
    const order = deliveredOrder(customer.user.id, `audit-${Date.now()}`);
    const { returnId, returnItemId } = await createReturnVia(customer, order.id, 'REFUND');

    // Approval is a separate decision from receiving; without it the payout
    // below would be held back.
    await wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'SEALED', receivedQuantity: 1 });
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/start`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/complete`).send({
      findings: [
        { returnItemId, result: 'PASS', productCondition: 'NEW', packagingCondition: 'NEW', quantity: 1 },
      ],
    });
    await wh(warehouse.token, 'post', `/returns/${returnId}/disposition`)
      .send({ returnItemId, action: 'RESTOCK', quantity: 1 });

    const entries = db
      .prepare("SELECT action FROM audit_log WHERE entity_type = 'RETURN' AND entity_id = ? ORDER BY created_at ASC")
      .all(returnId) as Array<{ action: string }>;
    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain('RETURN_RECEIVED');
    expect(actions).toContain('INSPECTION_STARTED');
    expect(actions).toContain('INSPECTION_COMPLETED');
    expect(actions).toContain('RETURN_RESOLVED');

    // Each row names the operator who did the work.
    const actors = db
      .prepare("SELECT DISTINCT actor_id FROM audit_log WHERE entity_type = 'RETURN' AND entity_id = ?")
      .all(returnId) as Array<{ actor_id: string }>;
    expect(actors.every((row) => row.actor_id === warehouse.user.id)).toBe(true);

    // There is no mutating audit endpoint.
    const patch = await request(app)
      .patch(`/api/v1/warehouse/audit/${returnId}`)
      .set('Authorization', `Bearer ${warehouse.token}`)
      .send({ action: 'TAMPERED' });
    expect(patch.status).toBe(404);
  });
});
