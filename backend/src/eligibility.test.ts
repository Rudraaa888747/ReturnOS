import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './app.js';
import { db, initSchema } from './db.js';
import { seedDatabase } from './seed.js';
import { allowedResolutions, createOrder, creditBalance, getOrderDetail, resolveReturnAtResolved } from './store.js';

interface SessionBody {
  token: string;
  user: { id: string; email: string };
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
}

async function signupCustomer(prefix: string): Promise<SessionBody> {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email: uniqueEmail(prefix), password: 'Password123', fullName: `${prefix} Customer` });
  expect(res.status).toBe(201);
  return res.body as SessionBody;
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** A delivered order owned by `customerId`, priced in rupees as the legacy API takes them. */
function deliveredOrder(customerId: string, suffix: string, deliveredDaysAgo: number, unitPrice = 1299.99) {
  const order = createOrder({
    orderNumber: `ORD-TEST-${suffix}`,
    customerId,
    status: 'DELIVERED',
    createdAt: daysAgoIso(deliveredDaysAgo + 3),
    deliveredAt: daysAgoIso(deliveredDaysAgo),
    items: [{ productId: 'p-tee', sku: 'TEE-CORE-1', productName: 'Essential Cotton Tee', quantity: 1, unitPrice }],
  });
  const detail = getOrderDetail(customerId, order.id);
  expect(detail).not.toBeNull();
  return { order, detail: detail as NonNullable<typeof detail> };
}

let customer: SessionBody;

beforeAll(async () => {
  initSchema();
  seedDatabase();
  customer = await signupCustomer('elig');
});

describe('server-side return eligibility', () => {
  it('publishes the window deadline for a delivered order inside the window', () => {
    const { detail } = deliveredOrder(customer.user.id, `in-${Date.now()}`, 2);
    expect(detail.eligible).toBe(true);
    expect(detail.ineligibleReason).toBeNull();
    expect(detail.eligibleUntil).not.toBeNull();
    // The deadline sits in the future and is derived from the delivery date.
    expect(new Date(detail.eligibleUntil as string).getTime()).toBeGreaterThan(Date.now());
    expect(detail.items[0]?.ineligibleReason).toBeNull();
  });

  it('reports an expired window rather than a bare false', () => {
    const { detail } = deliveredOrder(customer.user.id, `out-${Date.now()}`, 400);
    expect(detail.eligible).toBe(false);
    expect(detail.ineligibleReason).toBe('Return window expired');
    expect(detail.items[0]?.ineligibleReason).toBe('Return window expired');
  });

  it('explains an undelivered order without inventing a deadline', () => {
    const order = createOrder({
      orderNumber: `ORD-TEST-pending-${Date.now()}`,
      customerId: customer.user.id,
      status: 'SHIPPED',
      items: [{ productId: 'p-tee', sku: 'TEE-CORE-1', productName: 'Essential Cotton Tee', quantity: 1, unitPrice: 899 }],
    });
    const detail = getOrderDetail(customer.user.id, order.id);
    expect(detail?.eligible).toBe(false);
    expect(detail?.eligibleUntil).toBeNull();
    expect(detail?.ineligibleReason).toBe('Available once the order is delivered');
  });

  it('rejects a return the eligibility payload marked ineligible', async () => {
    const { order, detail } = deliveredOrder(customer.user.id, `reject-${Date.now()}`, 400);
    expect(detail.eligible).toBe(false);
    const res = await request(app)
      .post('/api/v1/returns')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        orderId: order.id,
        items: [{ orderItemId: detail.items[0]?.id, quantity: 1, reasonCode: 'CHANGED_MIND' }],
        resolutionType: 'STORE_CREDIT',
        pickupKind: 'PICKUP',
        pickupAddress: 'Home',
      });
    expect(res.status).toBe(422);
    expect((res.body as { code: string }).code).toBe('RETURN_WINDOW_EXPIRED');
  });
});

describe('published resolution rules match enforcement', () => {
  it('excludes store credit for defective items, in the map and at submit', async () => {
    const { order, detail } = deliveredOrder(customer.user.id, `rules-${Date.now()}`, 1);

    // The map the client narrows its options with...
    expect(detail.resolutionsByReason.DEFECTIVE).not.toContain('STORE_CREDIT');
    expect(detail.resolutionsByReason.DEFECTIVE).toContain('REFUND');

    // ...agrees with what the server actually enforces.
    const res = await request(app)
      .post('/api/v1/returns')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        orderId: order.id,
        items: [{ orderItemId: detail.items[0]?.id, quantity: 1, reasonCode: 'DEFECTIVE' }],
        resolutionType: 'STORE_CREDIT',
        pickupKind: 'PICKUP',
        pickupAddress: 'Home',
      });
    expect(res.status).toBe(422);
    expect((res.body as { code: string }).code).toBe('RESOLUTION_NOT_ALLOWED');
  });

  it('offers store credit for a change of mind and accepts it', async () => {
    const { order, detail } = deliveredOrder(customer.user.id, `mind-${Date.now()}`, 1);
    expect(detail.resolutionsByReason.CHANGED_MIND).toContain('STORE_CREDIT');

    const res = await request(app)
      .post('/api/v1/returns')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        orderId: order.id,
        items: [{ orderItemId: detail.items[0]?.id, quantity: 1, reasonCode: 'CHANGED_MIND' }],
        resolutionType: 'STORE_CREDIT',
        pickupKind: 'PICKUP',
        pickupAddress: 'Home',
      });
    expect(res.status).toBe(201);
  });

  it('covers every seeded reason so the client never has to guess', () => {
    const { detail } = deliveredOrder(customer.user.id, `cover-${Date.now()}`, 1);
    const seeded = db.prepare('SELECT code FROM return_reasons WHERE active = 1').all() as Array<{ code: string }>;
    expect(seeded.length).toBeGreaterThan(0);
    for (const { code } of seeded) {
      expect(Object.keys(detail.resolutionsByReason)).toContain(code);
      expect(detail.resolutionsByReason[code]).toEqual([...allowedResolutions([code], detail.order.delivered_at)]);
    }
  });
});

describe('money is exact integer paise', () => {
  it('keeps a price with paise exact from order to store credit', async () => {
    // 1299.99 has no exact binary representation; a float-only path can drift.
    const { order, detail } = deliveredOrder(customer.user.id, `money-${Date.now()}`, 1, 1299.99);
    const item = detail.items[0];
    expect(item?.unit_price_paise).toBe(129999);
    expect(item?.line_total_paise).toBe(129999);
    expect(detail.order.subtotal_paise).toBe(129999);

    const created = await request(app)
      .post('/api/v1/returns')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        orderId: order.id,
        items: [{ orderItemId: item?.id, quantity: 1, reasonCode: 'CHANGED_MIND' }],
        resolutionType: 'STORE_CREDIT',
        pickupKind: 'PICKUP',
        pickupAddress: 'Home',
      });
    expect(created.status).toBe(201);
    const returnId = (created.body as { ret: { id: string } }).ret.id;

    const refund = db.prepare('SELECT amount_paise FROM refunds WHERE return_id = ?').get(returnId) as {
      amount_paise: number;
    };
    expect(refund.amount_paise).toBe(129999);

    const before = creditBalance(customer.user.id);
    resolveReturnAtResolved(returnId);
    // Exactly the purchase price reaches the ledger, to the paise.
    expect(creditBalance(customer.user.id) - before).toBe(129999);
  });

  it('sums multiple paise-priced lines without drift', () => {
    const order = createOrder({
      orderNumber: `ORD-TEST-multi-${Date.now()}`,
      customerId: customer.user.id,
      status: 'DELIVERED',
      deliveredAt: daysAgoIso(1),
      items: [
        { productId: 'p-tee', sku: 'TEE-CORE-1', productName: 'Tee', quantity: 3, unitPrice: 0.1 },
        { productId: 'p-denim', sku: 'DENIM-SLIM-32', productName: 'Jeans', quantity: 3, unitPrice: 0.2 },
      ],
    });
    const detail = getOrderDetail(customer.user.id, order.id);
    const totalPaise = (detail?.items ?? []).reduce((sum, item) => sum + (item.line_total_paise ?? 0), 0);
    // 3x10p + 3x20p = 90p exactly; summing float rupees gives 0.8999999999999999.
    expect(totalPaise).toBe(90);
  });
});
