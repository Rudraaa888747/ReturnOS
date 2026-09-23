import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db, initSchema } from '../db.js';
import { seedDatabase } from '../seed.js';
import { creditBalance, createOrder, resolveReturnAtResolved } from '../store.js';
import { tickFulfillment } from '../fulfillment.js';
import { bucketQuantity } from './inventory.js';
import { DEFAULT_WAREHOUSE_ID } from './schema.js';

/**
 * Phase 4 — Customer ↔ Warehouse synchronization for every resolution kind.
 *
 * Drives each path end-to-end through the real warehouse API
 * (approve → receive → inspect → disposition) and asserts what the
 * CUSTOMER sees afterwards: ledger balance + /credit, refund state on the
 * return detail, and the linked replacement/exchange order in /orders plus
 * its journey through the existing fulfillment scheduler.
 *
 * The last block reproduces a genuine gap first (replacement shipments never
 * decrement sellable stock), so the fix that follows is proven, not assumed.
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

/** A delivered order for `customerId` containing one catalogue product. */
function deliveredOrder(customerId: string, suffix: string, productId = 'p-tee', quantity = 1) {
  const product = db.prepare('SELECT sku, name, price_paise FROM products WHERE id = ?').get(productId) as {
    sku: string;
    name: string;
    price_paise: number;
  };
  return createOrder({
    orderNumber: `ORD-P4-${suffix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    customerId,
    status: 'DELIVERED',
    createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    deliveredAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
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

/** Approve → receive → inspect (PASS) → disposition. Returns the disposition response. */
async function driveToDisposition(
  warehouseToken: string,
  returnId: string,
  returnItemId: string,
  action = 'RESTOCK',
) {
  await wh(warehouseToken, 'post', `/returns/${returnId}/approve`).send({});
  const received = await wh(warehouseToken, 'post', `/returns/${returnId}/receive`).send({
    packageCondition: 'SEALED',
    receivedQuantity: 1,
  });
  expect(received.status).toBe(201);
  await wh(warehouseToken, 'post', `/returns/${returnId}/inspection/start`).send({});
  await wh(warehouseToken, 'post', `/returns/${returnId}/inspection/complete`).send({
    findings: [
      { returnItemId, result: 'PASS', productCondition: 'LIKE_NEW', packagingCondition: 'NEW', quantity: 1 },
    ],
  });
  const res = await wh(warehouseToken, 'post', `/returns/${returnId}/disposition`).send({
    returnItemId,
    action,
    quantity: 1,
  });
  expect(res.status).toBe(201);
  return res;
}

function customerGet(token: string, path: string) {
  return request(app).get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
}

let warehouse: Session;

beforeAll(async () => {
  initSchema();
  seedDatabase();
  warehouse = await loginWarehouse();
});

describe('store credit syncs to the customer', () => {
  it('issues exactly once and shows up in balance + history', async () => {
    const customer = await signupCustomer('p4credit');
    const order = deliveredOrder(customer.user.id, 'credit');
    const { returnId, returnItemId } = await createReturnVia(customer, order.id, 'STORE_CREDIT');
    const before = creditBalance(customer.user.id);

    const res = await driveToDisposition(warehouse.token, returnId, returnItemId);
    expect((res.body as { returnResolved: boolean }).returnResolved).toBe(true);

    const ledger = db
      .prepare("SELECT amount_paise FROM store_credit_ledger WHERE reference_type = 'RETURN' AND reference_id = ?")
      .all(returnId) as Array<{ amount_paise: number }>;
    expect(ledger).toHaveLength(1);

    // The customer sees the money, not just the database row.
    const credit = await customerGet(customer.token, '/credit');
    expect(credit.status).toBe(200);
    expect((credit.body as { balancePaise: number }).balancePaise).toBe(before + ledger[0].amount_paise);
    const history = (credit.body as { history: Array<{ type: string; reference_type: string; reference_id: string }> }).history;
    const entry = history.find((row) => row.reference_type === 'RETURN' && row.reference_id === returnId);
    expect(entry?.type).toBe('CREDIT');

    const detail = await customerGet(customer.token, `/returns/${returnId}`);
    expect((detail.body as { ret: { status: string } }).ret.status).toBe('RESOLVED');
    expect((detail.body as { refund: { status: string } }).refund.status).toBe('COMPLETED');
  });
});

describe('refund syncs to the customer', () => {
  it('moves PENDING → COMPLETED and stays visible on the return', async () => {
    const customer = await signupCustomer('p4refund');
    const order = deliveredOrder(customer.user.id, 'refund');
    const { returnId, returnItemId } = await createReturnVia(customer, order.id, 'REFUND');

    const pending = await customerGet(customer.token, `/returns/${returnId}`);
    expect((pending.body as { refund: { status: string } }).refund.status).toBe('PENDING');

    await driveToDisposition(warehouse.token, returnId, returnItemId);

    const done = await customerGet(customer.token, `/returns/${returnId}`);
    expect((done.body as { ret: { status: string } }).ret.status).toBe('RESOLVED');
    expect((done.body as { refund: { status: string } }).refund.status).toBe('COMPLETED');
    const events = (done.body as { events: Array<{ status: string }> }).events;
    expect(events.map((event) => event.status)).toContain('RESOLVED');

    // A refund never touches the credit ledger.
    const creditRows = db
      .prepare("SELECT id FROM store_credit_ledger WHERE reference_type = 'RETURN' AND reference_id = ?")
      .all(returnId) as Array<{ id: string }>;
    expect(creditRows).toHaveLength(0);
  });
});

describe('replacement orders', () => {
  it('creates a linked zero-value order the customer can see', async () => {
    const customer = await signupCustomer('p4repl');
    const order = deliveredOrder(customer.user.id, 'repl');
    const { returnId, returnItemId } = await createReturnVia(customer, order.id, 'REPLACEMENT', 'DEFECTIVE');

    await driveToDisposition(warehouse.token, returnId, returnItemId);

    const created = db
      .prepare('SELECT id, order_number, kind, source_return_id, status, subtotal_paise FROM orders WHERE source_return_id = ?')
      .get(returnId) as {
        id: string;
        order_number: string;
        kind: string;
        source_return_id: string;
        status: string;
        subtotal_paise: number;
      };
    expect(created.kind).toBe('REPLACEMENT');
    expect(created.source_return_id).toBe(returnId);
    expect(created.status).toBe('PROCESSING');
    expect(created.subtotal_paise).toBe(0);

    // Visible in the customer's order list…
    const list = await customerGet(customer.token, '/orders');
    const numbers = ((list.body as { orders: Array<{ order_number: string }> }).orders).map((row) => row.order_number);
    expect(numbers).toContain(created.order_number);

    // …and in full on its detail page, with the returned product copied over.
    const detail = await customerGet(customer.token, `/orders/${created.id}`);
    expect((detail.body as { order: { kind: string } }).order.kind).toBe('REPLACEMENT');
    const items = (detail.body as { items: Array<{ product_name: string; quantity: number; unit_price_paise: number }> }).items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(1);
    expect(items[0].unit_price_paise).toBe(0);

    const notes = db
      .prepare("SELECT body FROM notifications WHERE user_id = ? AND body LIKE '%Replacement order%'")
      .all(customer.user.id) as Array<{ body: string }>;
    expect(notes.length).toBeGreaterThan(0);
  });

  it('flows through the existing fulfillment scheduler to DELIVERED', async () => {
    const customer = await signupCustomer('p4fulfil');
    const order = deliveredOrder(customer.user.id, 'fulfil');
    const { returnId, returnItemId } = await createReturnVia(customer, order.id, 'REPLACEMENT', 'DEFECTIVE');
    await driveToDisposition(warehouse.token, returnId, returnItemId);

    const created = db.prepare('SELECT id FROM orders WHERE source_return_id = ?').get(returnId) as { id: string };

    for (let tick = 0; tick < 10; tick += 1) {
      const current = db.prepare('SELECT status FROM orders WHERE id = ?').get(created.id) as { status: string };
      if (current.status === 'DELIVERED') break;
      const past = new Date(Date.now() - 3_600_000).toISOString();
      db.prepare('UPDATE order_events SET created_at = ? WHERE order_id = ?').run(past, created.id);
      db.prepare('UPDATE orders SET created_at = ? WHERE id = ?').run(past, created.id);
      tickFulfillment();
    }

    const final = db.prepare('SELECT status, delivered_at FROM orders WHERE id = ?').get(created.id) as {
      status: string;
      delivered_at: string | null;
    };
    expect(final.status).toBe('DELIVERED');
    expect(final.delivered_at).not.toBeNull();

    // The customer can track every stage of the replacement shipment.
    const tracking = await customerGet(customer.token, `/orders/${created.id}/tracking`);
    expect(tracking.status).toBe(200);
    expect((tracking.body as { status: string }).status).toBe('DELIVERED');
    const stages = ((tracking.body as { events: Array<{ status: string }> }).events).map((event) => event.status);
    expect(stages).toEqual(expect.arrayContaining(['PROCESSING', 'SHIPPED', 'DELIVERED']));
  });

  it('exchange mirrors the replacement linkage', async () => {
    const customer = await signupCustomer('p4exch');
    const order = deliveredOrder(customer.user.id, 'exch');
    const { returnId, returnItemId } = await createReturnVia(customer, order.id, 'EXCHANGE', 'DEFECTIVE');
    await driveToDisposition(warehouse.token, returnId, returnItemId);

    const created = db
      .prepare('SELECT id, order_number, kind, source_return_id, status FROM orders WHERE source_return_id = ?')
      .get(returnId) as { id: string; order_number: string; kind: string; source_return_id: string; status: string };
    expect(created.kind).toBe('EXCHANGE');
    expect(created.source_return_id).toBe(returnId);
    expect(created.status).toBe('PROCESSING');

    const list = await customerGet(customer.token, '/orders');
    const numbers = ((list.body as { orders: Array<{ order_number: string }> }).orders).map((row) => row.order_number);
    expect(numbers).toContain(created.order_number);
  });

  it('approval still gates the replacement shipment', async () => {
    const customer = await signupCustomer('p4gate');
    const order = deliveredOrder(customer.user.id, 'gate');
    const { returnId, returnItemId } = await createReturnVia(customer, order.id, 'REPLACEMENT', 'DEFECTIVE');

    // Same physical flow, but nobody approved the claim.
    const received = await wh(warehouse.token, 'post', `/returns/${returnId}/receive`).send({
      packageCondition: 'SEALED',
      receivedQuantity: 1,
    });
    expect(received.status).toBe(201);
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/start`).send({});
    await wh(warehouse.token, 'post', `/returns/${returnId}/inspection/complete`).send({
      findings: [
        { returnItemId, result: 'PASS', productCondition: 'LIKE_NEW', packagingCondition: 'NEW', quantity: 1 },
      ],
    });
    const disp = await wh(warehouse.token, 'post', `/returns/${returnId}/disposition`).send({
      returnItemId,
      action: 'RESTOCK',
      quantity: 1,
    });
    expect(disp.status).toBe(201);
    expect((disp.body as { returnResolved: boolean }).returnResolved).toBe(false);

    // No shipment for an unapproved claim.
    const held = db.prepare('SELECT id FROM orders WHERE source_return_id = ?').get(returnId) as
      | { id: string }
      | undefined;
    expect(held).toBeUndefined();

    // Approving releases the held resolution and the shipment appears.
    const approved = await wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({});
    expect(approved.status).toBe(200);
    const released = db.prepare('SELECT kind FROM orders WHERE source_return_id = ?').get(returnId) as
      | { kind: string }
      | undefined;
    expect(released?.kind).toBe('REPLACEMENT');
  });
});

describe('replacement shipments consume sellable stock', () => {
  it('restock + replacement nets to zero instead of inflating stock', async () => {
    const customer = await signupCustomer('p4stock');
    const stockBefore = (
      db.prepare('SELECT stock FROM products WHERE id = ?').get('p-tee') as { stock: number }
    ).stock;
    const bucketBefore = bucketQuantity(DEFAULT_WAREHOUSE_ID, 'p-tee', 'AVAILABLE');

    const order = deliveredOrder(customer.user.id, 'stock');
    const { returnId, returnItemId } = await createReturnVia(customer, order.id, 'REPLACEMENT', 'DEFECTIVE');
    await driveToDisposition(warehouse.token, returnId, returnItemId);

    // The returned unit went back on the shelf (+1) and the replacement unit
    // shipped back out (−1): physically a wash, so the books must agree.
    const stockAfter = (
      db.prepare('SELECT stock FROM products WHERE id = ?').get('p-tee') as { stock: number }
    ).stock;
    const bucketAfter = bucketQuantity(DEFAULT_WAREHOUSE_ID, 'p-tee', 'AVAILABLE');
    expect(stockAfter).toBe(stockBefore);
    expect(bucketAfter).toBe(bucketBefore);
  });

  it('warns loudly when resolving a replacement with no receiving record', async () => {
    const customer = await signupCustomer('p4fallback');
    const order = deliveredOrder(customer.user.id, 'fallback');
    const { returnId } = await createReturnVia(customer, order.id, 'REPLACEMENT', 'DEFECTIVE');

    // Approve the claim but never receive it: the engine resolves without any
    // warehouse floor trace, which is exactly when the default-pool fallback
    // engages.
    const approved = await wh(warehouse.token, 'post', `/returns/${returnId}/approve`).send({});
    expect(approved.status).toBe(200);

    const stockBefore = (
      db.prepare('SELECT stock FROM products WHERE id = ?').get('p-tee') as { stock: number }
    ).stock;
    resolveReturnAtResolved(returnId);

    const created = db.prepare('SELECT kind FROM orders WHERE source_return_id = ?').get(returnId) as
      | { kind: string }
      | undefined;
    expect(created?.kind).toBe('REPLACEMENT');

    // The fallback shipped from the default pool — and said so in audit_log,
    // where the WARNING_% dashboard query picks it up automatically.
    const warn = db
      .prepare("SELECT metadata FROM audit_log WHERE action = 'WARNING_RESOLUTION_WAREHOUSE_FALLBACK' AND entity_id = ?")
      .get(returnId) as { metadata: string } | undefined;
    expect(warn).toBeDefined();
    expect(JSON.parse(warn?.metadata ?? '{}')).toMatchObject({ returnId });

    const stockAfter = (
      db.prepare('SELECT stock FROM products WHERE id = ?').get('p-tee') as { stock: number }
    ).stock;
    expect(stockAfter).toBe(stockBefore - 1);
  });
});
