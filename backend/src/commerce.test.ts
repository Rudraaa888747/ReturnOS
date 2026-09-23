import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './app.js';
import { db, initSchema } from './db.js';
import { seedDatabase } from './seed.js';
import {
  FLAT_SHIPPING_PAISE,
  FREE_SHIPPING_THRESHOLD_PAISE,
  addLedgerEntry,
  createOrder,
  creditBalance,
  getOrderDetail,
  resolveReturnAtResolved,
} from './store.js';

interface SessionBody {
  token: string;
  user: { id: string; email: string };
}

/** The camelCase shape the products API serves to the client. */
interface ProductBody {
  id: string;
  sku: string;
  name: string;
  pricePaise: number;
  imageUrl: string | null;
  stock: number;
  active: boolean;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
}

async function signupCustomer(prefix: string): Promise<SessionBody> {
  const res = await request(app).post('/api/v1/auth/signup').send({
    email: uniqueEmail(prefix),
    password: 'Password123',
    fullName: `${prefix} Customer`,
  });
  expect(res.status).toBe(201);
  return res.body as SessionBody;
}

async function createAddress(token: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/addresses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName: 'Test Buyer',
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

let customerA: SessionBody;
let customerB: SessionBody;
let addressA = '';
let checkoutOrderId = '';

beforeAll(async () => {
  initSchema();
  seedDatabase();
  customerA = await signupCustomer('commerce-a');
  customerB = await signupCustomer('commerce-b');
  addressA = await createAddress(customerA.token);
});

describe('catalog products', () => {
  it('lists 5 active products', async () => {
    const res = await request(app).get('/api/v1/products').set('Authorization', `Bearer ${customerA.token}`);
    expect(res.status).toBe(200);
    const products = (res.body as { products: ProductBody[] }).products;
    expect(products).toHaveLength(5);
    const ids = products.map((p) => p.id).sort();
    expect(ids).toEqual(['p-airmax', 'p-aurora', 'p-denim', 'p-tee', 'p-trail'].sort());
  });

  it('hides inactive products', async () => {
    db.prepare("INSERT OR IGNORE INTO products (id, sku, name, description, details, price_paise, image_url, stock, active, created_at, updated_at) VALUES ('p-hidden', 'HIDDEN-1', 'Hidden Item', '', '', 10000, '/products/hidden.svg', 5, 0, ?, ?)").run(
      new Date().toISOString(), new Date().toISOString(),
    );
    const res = await request(app).get('/api/v1/products').set('Authorization', `Bearer ${customerA.token}`);
    expect(res.status).toBe(200);
    const products = (res.body as { products: ProductBody[] }).products;
    expect(products).toHaveLength(5);
    expect(products.find((p) => p.id === 'p-hidden')).toBeUndefined();
    const single = await request(app).get('/api/v1/products/p-hidden').set('Authorization', `Bearer ${customerA.token}`);
    expect(single.status).toBe(404);
    expect((single.body as { code: string }).code).toBe('PRODUCT_NOT_FOUND');
  });

  it('serves a single product', async () => {
    const res = await request(app).get('/api/v1/products/p-tee').set('Authorization', `Bearer ${customerA.token}`);
    expect(res.status).toBe(200);
    expect((res.body as { product: ProductBody }).product.id).toBe('p-tee');
  });
});

describe('cart behavior', () => {
  it('adds, updates, and removes lines', async () => {
    await request(app).delete(`/api/v1/cart/p-tee`).set('Authorization', `Bearer ${customerA.token}`);
    const added = await request(app)
      .post('/api/v1/cart')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ productId: 'p-tee', quantity: 2 });
    expect(added.status).toBe(201);
    expect(added.body.totalQuantity).toBe(2);

    const updated = await request(app)
      .patch('/api/v1/cart/p-tee')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ quantity: 3 });
    expect(updated.status).toBe(200);
    expect(updated.body.totalQuantity).toBe(3);

    const fetched = await request(app).get('/api/v1/cart').set('Authorization', `Bearer ${customerA.token}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.subtotalPaise).toBeGreaterThan(0);

    const removed = await request(app).delete('/api/v1/cart/p-tee').set('Authorization', `Bearer ${customerA.token}`);
    expect(removed.status).toBe(200);
    expect(removed.body.totalQuantity).toBe(0);
  });

  it('rejects quantities above stock with 409', async () => {
    const res = await request(app)
      .post('/api/v1/cart')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ productId: 'p-airmax', quantity: 26 });
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('INSUFFICIENT_STOCK');
  });

  it('isolates carts per user', async () => {
    await request(app).delete('/api/v1/cart/p-tee').set('Authorization', `Bearer ${customerA.token}`);
    await request(app).delete('/api/v1/cart/p-tee').set('Authorization', `Bearer ${customerB.token}`);
    await request(app)
      .post('/api/v1/cart')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ productId: 'p-tee', quantity: 1 });
    const bCart = await request(app).get('/api/v1/cart').set('Authorization', `Bearer ${customerB.token}`);
    expect(bCart.status).toBe(200);
    expect(bCart.body.totalQuantity).toBe(0);
    expect(bCart.body.items).toHaveLength(0);
    await request(app).delete('/api/v1/cart/p-tee').set('Authorization', `Bearer ${customerA.token}`);
  });
});

describe('checkout math and idempotency', () => {
  it('charges shipping below the free threshold', async () => {
    await request(app).delete('/api/v1/cart/p-tee').set('Authorization', `Bearer ${customerA.token}`);
    await request(app).delete('/api/v1/cart/p-denim').set('Authorization', `Bearer ${customerA.token}`);
    await request(app)
      .post('/api/v1/cart')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ productId: 'p-tee', quantity: 1 });
    const quote = await request(app)
      .post('/api/v1/checkout/quote')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ addressId: addressA, useStoreCredit: false });
    expect(quote.status).toBe(200);
    // Derived from the catalogue and the shipping policy, so a repricing shows
    // up as a policy decision to make rather than a broken assertion.
    const teeRes = await request(app).get('/api/v1/products/p-tee').set('Authorization', `Bearer ${customerA.token}`);
    const teePaise = (teeRes.body as { product: ProductBody }).product.pricePaise;
    expect(teePaise).toBeLessThan(FREE_SHIPPING_THRESHOLD_PAISE);
    expect(quote.body.subtotalPaise).toBe(teePaise);
    expect(quote.body.shippingPaise).toBe(FLAT_SHIPPING_PAISE);
    expect(quote.body.totalPaise).toBe(teePaise + FLAT_SHIPPING_PAISE);
    expect(quote.body.payablePaise).toBe(teePaise + FLAT_SHIPPING_PAISE);
    await request(app).delete('/api/v1/cart/p-tee').set('Authorization', `Bearer ${customerA.token}`);
  });

  it('caps store credit so overuse is impossible', async () => {
    await request(app)
      .post('/api/v1/cart')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ productId: 'p-tee', quantity: 1 });
    // Tiny balance relative to the total.
    addLedgerEntry({
      userId: customerA.user.id,
      type: 'CREDIT',
      amountPaise: 2000,
      reason: 'Test top-up',
      referenceType: 'TEST',
      referenceId: `test-topup-${Date.now()}`,
    });
    const quote = await request(app)
      .post('/api/v1/checkout/quote')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ addressId: addressA, useStoreCredit: true });
    expect(quote.status).toBe(200);
    expect(quote.body.creditToUsePaise).toBeLessThanOrEqual(2000 + 0);
    expect(quote.body.creditToUsePaise).toBeLessThanOrEqual(quote.body.totalPaise);
    expect(quote.body.payablePaise).toBe(quote.body.totalPaise - quote.body.creditToUsePaise);
    await request(app).delete('/api/v1/cart/p-tee').set('Authorization', `Bearer ${customerA.token}`);
  });

  it('places an order idempotently on double POST', async () => {
    await request(app)
      .post('/api/v1/cart')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ productId: 'p-denim', quantity: 1 });
    const key = `idem-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const first = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ addressId: addressA, useStoreCredit: false, idempotencyKey: key });
    expect(first.status).toBe(201);
    const firstId = (first.body as { order: { id: string } }).order.id;
    checkoutOrderId = firstId;

    const second = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ addressId: addressA, useStoreCredit: false, idempotencyKey: key });
    expect(second.status).toBe(200);
    expect((second.body as { order: { id: string } }).order.id).toBe(firstId);

    const orders = await request(app).get('/api/v1/orders').set('Authorization', `Bearer ${customerA.token}`);
    const matches = (orders.body as { orders: Array<{ id: string }> }).orders.filter((o) => o.id === firstId);
    expect(matches).toHaveLength(1);
  });

  it('rejects checkout with insufficient stock', async () => {
    await request(app)
      .post('/api/v1/cart')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ productId: 'p-aurora', quantity: 1 });
    db.prepare('UPDATE products SET stock = 0 WHERE id = ?').run('p-aurora');
    const res = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ addressId: addressA, useStoreCredit: false, idempotencyKey: `idem-stock-${Date.now()}` });
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('INSUFFICIENT_STOCK');
    db.prepare('UPDATE products SET stock = 40 WHERE id = ?').run('p-aurora');
    await request(app).delete('/api/v1/cart/p-aurora').set('Authorization', `Bearer ${customerA.token}`);
    await request(app).delete('/api/v1/cart/p-denim').set('Authorization', `Bearer ${customerA.token}`);
  });
});

describe('store credit resolution', () => {
  it('issues ledger credit exactly once across double resolve', async () => {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const order = createOrder({
      orderNumber: `ORD-CRED-${stamp}`,
      customerId: customerA.user.id,
      status: 'DELIVERED',
      createdAt: daysAgoIso(10),
      deliveredAt: daysAgoIso(5),
      items: [{ productId: 'p-tee', sku: `TEE-${stamp}`, productName: 'Essential Cotton Tee', quantity: 1, unitPrice: 499 }],
    });
    const detail = getOrderDetail(customerA.user.id, order.id);
    expect(detail).not.toBeNull();
    const orderItemId = detail?.items[0]?.id ?? '';
    const created = await request(app)
      .post('/api/v1/returns')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({
        orderId: order.id,
        items: [{ orderItemId, quantity: 1, reasonCode: 'OTHER' }],
        resolutionType: 'STORE_CREDIT',
        pickupKind: 'PICKUP',
      });
    expect(created.status).toBe(201);
    const returnId = (created.body as { ret: { id: string } }).ret.id;

    const before = creditBalance(customerA.user.id);
    resolveReturnAtResolved(returnId);
    const afterFirst = creditBalance(customerA.user.id);
    expect(afterFirst - before).toBe(49900);
    resolveReturnAtResolved(returnId);
    const afterSecond = creditBalance(customerA.user.id);
    expect(afterSecond).toBe(afterFirst);

    const history = db
      .prepare('SELECT COUNT(*) AS count FROM store_credit_ledger WHERE reference_type = ? AND reference_id = ?')
      .get('RETURN', returnId) as { count: number };
    expect(history.count).toBe(1);
  });
});

describe('cross-customer isolation', () => {
  it('hides orders, tracking, and credit across customers', async () => {
    expect(checkoutOrderId.length).toBeGreaterThan(0);
    const foreignOrder = await request(app)
      .get(`/api/v1/orders/${checkoutOrderId}`)
      .set('Authorization', `Bearer ${customerB.token}`);
    expect(foreignOrder.status).toBe(404);

    const foreignTracking = await request(app)
      .get(`/api/v1/orders/${checkoutOrderId}/tracking`)
      .set('Authorization', `Bearer ${customerB.token}`);
    expect(foreignTracking.status).toBe(404);

    const ownTracking = await request(app)
      .get(`/api/v1/orders/${checkoutOrderId}/tracking`)
      .set('Authorization', `Bearer ${customerA.token}`);
    expect(ownTracking.status).toBe(200);
    expect(typeof (ownTracking.body as { orderNumber: string }).orderNumber).toBe('string');

    const balanceBefore = creditBalance(customerA.user.id);
    const bCredit = await request(app).get('/api/v1/credit').set('Authorization', `Bearer ${customerB.token}`);
    expect(bCredit.status).toBe(200);
    expect((bCredit.body as { balancePaise: number }).balancePaise).toBe(creditBalance(customerB.user.id));
    expect(creditBalance(customerA.user.id)).toBe(balanceBefore);
  });
});

describe('product API contract', () => {
  it('serves camelCase fields the client can render', async () => {
    const res = await request(app).get('/api/v1/products').set('Authorization', `Bearer ${customerA.token}`);
    expect(res.status).toBe(200);
    for (const product of (res.body as { products: ProductBody[] }).products) {
      // A raw database row would put price under price_paise and leave
      // pricePaise undefined, which rendered as "₹NaN" in the storefront.
      expect(Number.isFinite(product.pricePaise)).toBe(true);
      expect(product.pricePaise).toBeGreaterThan(0);
      expect(product).not.toHaveProperty('price_paise');
      expect(typeof product.sku).toBe('string');
      expect(typeof product.active).toBe('boolean');
    }
  });

  it('serves the same shape for a single product', async () => {
    const res = await request(app).get('/api/v1/products/p-tee').set('Authorization', `Bearer ${customerA.token}`);
    expect(res.status).toBe(200);
    const product = (res.body as { product: ProductBody }).product;
    expect(Number.isFinite(product.pricePaise)).toBe(true);
    // Catalogue images are real product photos (remote URLs) or local assets.
    expect(product.imageUrl).toMatch(/^(\/products\/|https?:\/\/)/);
    expect(product).not.toHaveProperty('price_paise');
  });
});
