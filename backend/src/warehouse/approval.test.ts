import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db, initSchema } from '../db.js';
import { seedDatabase } from '../seed.js';
import { createOrder, creditBalance } from '../store.js';
import { tickFulfillment } from '../fulfillment.js';
import { consumeAvailableStock, syncAvailableBuckets } from './inventory.js';
import { DEFAULT_WAREHOUSE_ID } from './schema.js';

/**
 * Two safety properties that are easy to lose and expensive to lose quietly:
 *
 *  - receiving a parcel must not approve the claim, and nothing may pay out
 *    on a return that was never approved;
 *  - when the sellable bucket is short of a sale it is clamped, and that clamp
 *    must be recorded, because a silent clamp hides real drift.
 */

interface Session {
  token: string;
  user: { id: string };
}

let warehouse: Session;
let customer: Session;

function wh(token: string, method: 'get' | 'post', path: string) {
  return request(app)[method](`/api/v1/warehouse${path}`).set('Authorization', `Bearer ${token}`);
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function deliveredOrder(customerId: string, suffix: string, productId = 'p-tee') {
  const product = db.prepare('SELECT sku, name, price_paise FROM products WHERE id = ?').get(productId) as {
    sku: string;
    name: string;
    price_paise: number;
  };
  return createOrder({
    orderNumber: `ORD-APP-${suffix}`,
    customerId,
    status: 'DELIVERED',
    createdAt: daysAgoIso(5),
    deliveredAt: daysAgoIso(2),
    items: [
      { productId, sku: product.sku, productName: product.name, quantity: 1, unitPrice: product.price_paise / 100 },
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

/** Receive, inspect and complete inspection, leaving only disposition to do. */
async function processToDisposition(returnId: string, returnItemId: string): Promise<void> {
  await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
    .send({ packageCondition: 'SEALED', receivedQuantity: 1 });
  await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/start`).send({});
  await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/complete`).send({
    findings: [{ returnItemId, result: 'PASS', productCondition: 'NEW', packagingCondition: 'NEW', quantity: 1 }],
  });
}

beforeAll(async () => {
  initSchema();
  seedDatabase();
  const w = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'warehouse@returnos.test', password: 'Warehouse123' });
  expect(w.status).toBe(200);
  warehouse = w.body as Session;
  const c = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email: `approval-${Date.now()}@example.com`, password: 'Password123', fullName: 'Approval Customer' });
  expect(c.status).toBe(201);
  customer = c.body as Session;
});

describe('approval gate', () => {
  it('receiving a parcel does not approve the claim', async () => {
    const order = deliveredOrder(customer.user.id, `noapprove-${Date.now()}`);
    const { returnId } = await createReturnVia(order.id, 'REFUND');

    const fresh = db.prepare('SELECT approved_at FROM returns WHERE id = ?').get(returnId) as {
      approved_at: string | null;
    };
    expect(fresh.approved_at).toBeNull();

    await wh(warehouse.token, 'post', `/returns/${returnId}/receive`)
      .send({ packageCondition: 'SEALED', receivedQuantity: 1 });

    const row = db.prepare('SELECT approved_at, status FROM returns WHERE id = ?').get(returnId) as {
      approved_at: string | null;
      status: string;
    };
    expect(row.status).toBe('RECEIVED');
    expect(row.approved_at, 'receiving must not stamp approval').toBeNull();

    // The exception is flagged rather than passing unnoticed.
    const warned = db
      .prepare("SELECT action FROM audit_log WHERE entity_id = ? AND action = 'WARNING_RECEIVED_BEFORE_APPROVAL'")
      .all(returnId);
    expect(warned).toHaveLength(1);
  });

  it('holds the payout when the return was never approved', async () => {
    const before = creditBalance(customer.user.id);
    const order = deliveredOrder(customer.user.id, `held-${Date.now()}`);
    const { returnId, returnItemId } = await createReturnVia(order.id, 'STORE_CREDIT');
    await processToDisposition(returnId, returnItemId);

    const res = await wh(warehouse.token, 'post', `/returns/${returnId}/disposition`)
      .send({ returnItemId, action: 'RESTOCK', quantity: 1 });
    expect(res.status).toBe(201);

    // The goods were handled, but no money moved.
    expect((res.body as { returnResolved: boolean }).returnResolved).toBe(false);
    expect(creditBalance(customer.user.id)).toBe(before);

    const ret = db.prepare('SELECT status FROM returns WHERE id = ?').get(returnId) as { status: string };
    expect(ret.status).not.toBe('RESOLVED');
    expect(
      db
        .prepare("SELECT action FROM audit_log WHERE entity_id = ? AND action = 'RESOLUTION_BLOCKED_PENDING_APPROVAL'")
        .all(returnId),
    ).toHaveLength(1);

    // It shows up as outstanding work rather than silently stalling.
    const summary = await wh(warehouse.token, 'get', '/summary');
    expect((summary.body as { pendingApproval: number }).pendingApproval).toBeGreaterThan(0);
  });

  it('releases the held resolution once approved, exactly once', async () => {
    const before = creditBalance(customer.user.id);
    const order = deliveredOrder(customer.user.id, `release-${Date.now()}`);
    const { returnId, returnItemId } = await createReturnVia(order.id, 'STORE_CREDIT');
    await processToDisposition(returnId, returnItemId);
    await wh(warehouse.token, 'post', `/returns/${returnId}/disposition`)
      .send({ returnItemId, action: 'RESTOCK', quantity: 1 });
    expect(creditBalance(customer.user.id)).toBe(before);

    const approved = await wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({});
    expect(approved.status).toBe(200);

    const ledger = db
      .prepare("SELECT amount_paise FROM store_credit_ledger WHERE reference_type = 'RETURN' AND reference_id = ?")
      .all(returnId) as Array<{ amount_paise: number }>;
    expect(ledger).toHaveLength(1);
    expect(creditBalance(customer.user.id)).toBe(before + ledger[0].amount_paise);

    const ret = db.prepare('SELECT status FROM returns WHERE id = ?').get(returnId) as { status: string };
    expect(ret.status).toBe('RESOLVED');
  });

  it('refuses to approve the same return twice', async () => {
    const order = deliveredOrder(customer.user.id, `twice-${Date.now()}`);
    const { returnId } = await createReturnVia(order.id, 'REFUND');
    expect((await wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({})).status).toBe(200);

    const second = await wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({});
    expect(second.status).toBe(409);
    expect((second.body as { code: string }).code).toBe('ALREADY_APPROVED');
  });

  it('resolves straight through when approval came first', async () => {
    const before = creditBalance(customer.user.id);
    const order = deliveredOrder(customer.user.id, `straight-${Date.now()}`);
    const { returnId, returnItemId } = await createReturnVia(order.id, 'STORE_CREDIT');

    await wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({});
    await processToDisposition(returnId, returnItemId);
    const res = await wh(warehouse.token, 'post', `/returns/${returnId}/disposition`)
      .send({ returnItemId, action: 'RESTOCK', quantity: 1 });

    expect((res.body as { returnResolved: boolean }).returnResolved).toBe(true);
    expect(creditBalance(customer.user.id)).toBeGreaterThan(before);

    // No warning is raised on the clean path.
    expect(
      db.prepare("SELECT action FROM audit_log WHERE entity_id = ? AND action LIKE 'WARNING_%'").all(returnId),
    ).toHaveLength(0);
  });
});

describe('inventory clamp is never silent', () => {
  function clampWarnings(): number {
    return (
      db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'WARNING_INVENTORY_CLAMPED'").get() as {
        count: number;
      }
    ).count;
  }

  it('records a warning when the bucket is short of the sale', () => {
    const productId = 'p-airmax';
    syncAvailableBuckets(DEFAULT_WAREHOUSE_ID);

    // Force the two representations out of step, as an out-of-band stock load would.
    db.prepare(
      "UPDATE inventory_buckets SET quantity = 0 WHERE warehouse_id = ? AND product_id = ? AND state = 'AVAILABLE'",
    ).run(DEFAULT_WAREHOUSE_ID, productId);

    const before = clampWarnings();
    const sold = consumeAvailableStock({
      warehouseId: DEFAULT_WAREHOUSE_ID,
      productId,
      quantity: 1,
      orderId: `clamp-order-${Date.now()}`,
    });
    expect(sold).toBe(true);
    expect(clampWarnings()).toBe(before + 1);

    const entry = db
      .prepare(
        "SELECT metadata FROM audit_log WHERE action = 'WARNING_INVENTORY_CLAMPED' ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .get() as { metadata: string };
    const metadata = JSON.parse(entry.metadata) as { shortfall: number; bucketHeld: number };
    expect(metadata.shortfall).toBe(1);
    expect(metadata.bucketHeld).toBe(0);

    syncAvailableBuckets(DEFAULT_WAREHOUSE_ID);
  });

  it('raises no warning when the bucket covers the sale', () => {
    syncAvailableBuckets(DEFAULT_WAREHOUSE_ID);
    const before = clampWarnings();
    consumeAvailableStock({
      warehouseId: DEFAULT_WAREHOUSE_ID,
      productId: 'p-denim',
      quantity: 1,
      orderId: `clean-order-${Date.now()}`,
    });
    expect(clampWarnings()).toBe(before);
  });

  it('surfaces the warning on the dashboard summary', async () => {
    const res = await wh(warehouse.token, 'get', '/summary');
    expect(res.status).toBe(200);
    const body = res.body as { warnings: Array<{ action: string; count: number }> };
    expect(body.warnings.some((entry) => entry.action === 'WARNING_INVENTORY_CLAMPED')).toBe(true);
  });
});

describe('approval stamp and timeline event stay together', () => {
  function approvalOf(returnId: string): { status: string; approved_at: string | null } {
    return db.prepare('SELECT status, approved_at FROM returns WHERE id = ?').get(returnId) as {
      status: string;
      approved_at: string | null;
    };
  }

  function hasApprovedEvent(returnId: string): boolean {
    const event = db
      .prepare("SELECT id FROM return_events WHERE return_id = ? AND status = 'APPROVED'")
      .get(returnId);
    return event !== undefined;
  }

  it('scheduler path stamps approved_at together with the APPROVED event', async () => {
    const order = deliveredOrder(customer.user.id, `sched-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`);
    const { returnId } = await createReturnVia(order.id, 'STORE_CREDIT');
    expect(approvalOf(returnId).approved_at).toBeNull();

    // Force the scheduler's APPROVED tick for this return only.
    db.prepare('UPDATE returns SET updated_at = ? WHERE id = ?').run(daysAgoIso(1), returnId);
    tickFulfillment();

    const after = approvalOf(returnId);
    expect(after.status).toBe('APPROVED');
    expect(after.approved_at).not.toBeNull();
    expect(hasApprovedEvent(returnId)).toBe(true);
  });

  it('approve endpoint stamps approved_at together with the APPROVED event', async () => {
    const order = deliveredOrder(customer.user.id, `ep-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`);
    const { returnId } = await createReturnVia(order.id, 'STORE_CREDIT');

    const res = await wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({});
    expect(res.status).toBe(200);

    expect(approvalOf(returnId).approved_at).not.toBeNull();
    expect(hasApprovedEvent(returnId)).toBe(true);
  });
});
