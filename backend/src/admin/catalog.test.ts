import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db, initSchema } from '../db.js';
import { seedDatabase } from '../seed.js';
import { createOrder } from '../store.js';
import { DEFAULT_WAREHOUSE_ID } from '../warehouse/schema.js';

/**
 * Phase 3 — admin catalogue writes, the pattern every later admin write
 * copies: transactional business change + before/after admin audit row,
 * explicit 409s (never silent) when the change would orphan products or
 * break in-flight customer transactions.
 */

interface Session {
  token: string;
  user: { id: string };
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
}

async function loginAdmin(): Promise<Session> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@returnos.test', password: 'Admin123' });
  expect(res.status).toBe(200);
  return res.body as Session;
}

async function signupCustomer(): Promise<Session> {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email: uniqueEmail('cat'), password: 'Password123', fullName: 'Catalog Customer' });
  expect(res.status).toBe(201);
  return res.body as Session;
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

let admin: Session;
let customer: Session;

beforeAll(async () => {
  initSchema();
  seedDatabase();
  admin = await loginAdmin();
  customer = await signupCustomer();
});

function adminReq(method: 'get' | 'post' | 'patch' | 'delete', path: string) {
  return request(app)[method](`/api/v1/admin${path}`).set('Authorization', `Bearer ${admin.token}`);
}

function auditFor(entityType: string, entityId: string, action: string) {
  return db
    .prepare('SELECT previous_state, new_state FROM admin_audit_log WHERE entity_type = ? AND entity_id = ? AND action = ?')
    .get(entityType, entityId, action) as { previous_state: string | null; new_state: string | null } | undefined;
}

describe('categories', () => {
  it('seeds the tree with live product counts', async () => {
    const res = await adminReq('get', '/categories');
    expect(res.status).toBe(200);
    const rows = (res.body as { categories: Array<{ id: string; name: string; product_count: number }> }).categories;
    expect(rows.map((row) => row.id)).toEqual(['c-footwear', 'c-apparel', 'c-accessories']);
    expect(rows.find((row) => row.id === 'c-footwear')?.product_count).toBe(2);
  });

  it('creates, renames and deletes an empty category with audit rows', async () => {
    const created = await adminReq('post', '/categories').send({ name: 'Test Gear', sortOrder: 9 });
    expect(created.status).toBe(201);
    const id = (created.body as { category: { id: string } }).category.id;
    expect(auditFor('CATEGORY', id, 'CATEGORY_CREATED')?.new_state).toContain('Test Gear');

    const renamed = await adminReq('patch', `/categories/${id}`).send({ name: 'Test Gear v2' });
    expect(renamed.status).toBe(200);
    const audit = auditFor('CATEGORY', id, 'CATEGORY_UPDATED');
    expect(audit?.previous_state).toContain('Test Gear');
    expect(audit?.new_state).toContain('Test Gear v2');

    const deleted = await adminReq('delete', `/categories/${id}`).send();
    expect(deleted.status).toBe(204);
    expect((await adminReq('get', `/categories/${id}`)).status).toBe(404);
  });

  it('rejects duplicate names', async () => {
    const res = await adminReq('post', '/categories').send({ name: 'Footwear' });
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('CATEGORY_NAME_EXISTS');
  });

  it('refuses to delete a category that still holds products', async () => {
    const res = await adminReq('delete', '/categories/c-footwear').send();
    expect(res.status).toBe(409);
    const body = res.body as { code: string; errors: { count: number; skus: string[] } };
    expect(body.code).toBe('CATEGORY_IN_USE');
    expect(body.errors.count).toBe(2);
    expect(body.errors.skus.length).toBeGreaterThan(0);
    // Still there, still assigned.
    expect((await adminReq('get', '/categories/c-footwear')).status).toBe(200);
  });

  it('404s unknown categories', async () => {
    expect((await adminReq('get', '/categories/nope')).status).toBe(404);
  });
});

describe('products', () => {
  it('lists with category names and in-flight counts', async () => {
    const res = await adminReq('get', '/products?sort=name&limit=5');
    expect(res.status).toBe(200);
    const body = res.body as {
      products: Array<{ sku: string; category_name: string | null; open_orders: number; open_returns: number }>;
      total: number;
    };
    expect(body.total).toBeGreaterThanOrEqual(5);
    expect(body.products[0]).toMatchObject({ sku: 'AIRMAX-90-UK9', category_name: 'Footwear' });
    expect(leaksCredentials(res.body)).toBe(false);
  });

  it('shows one product with buckets, movements and open transactions', async () => {
    const res = await adminReq('get', '/products/p-tee');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      product: { id: 'p-tee' },
      buckets: expect.any(Array),
      movements: expect.any(Array),
      openOrders: expect.any(Array),
      openReturns: expect.any(Array),
    });
  });

  it('creates a product with the sellable mirror in step, audited', async () => {
    const sku = `TST-${Date.now()}`;
    const res = await adminReq('post', '/products').send({
      sku,
      name: 'Test Runner',
      pricePaise: 99900,
      stock: 7,
      categoryId: 'c-footwear',
    });
    expect(res.status).toBe(201);
    const product = (res.body as { product: { id: string; category_id: string } }).product;
    expect(product.category_id).toBe('c-footwear');

    const bucket = db
      .prepare("SELECT quantity FROM inventory_buckets WHERE warehouse_id = ? AND product_id = ? AND state = 'AVAILABLE'")
      .get(DEFAULT_WAREHOUSE_ID, product.id) as { quantity: number };
    expect(bucket.quantity).toBe(7);

    const audit = auditFor('PRODUCT', product.id, 'PRODUCT_CREATED');
    expect(audit?.previous_state).toBe('null');
    expect(audit?.new_state).toContain(sku);
  });

  it('rejects duplicate SKUs and bad money', async () => {
    const dup = await adminReq('post', '/products').send({
      sku: 'AIRMAX-90-UK9',
      name: 'Copy',
      pricePaise: 100,
      stock: 1,
    });
    expect(dup.status).toBe(409);
    expect((dup.body as { code: string }).code).toBe('PRODUCT_SKU_EXISTS');

    const bad = await adminReq('post', '/products').send({
      sku: `TST-${Date.now()}`,
      name: 'Bad price',
      pricePaise: -5,
      stock: 1,
    });
    expect(bad.status).toBe(400);
  });

  it('refuses inactive categories on assignment', async () => {
    const off = await adminReq('post', '/categories').send({ name: 'Retired Line', active: false });
    expect(off.status).toBe(201);
    const categoryId = (off.body as { category: { id: string } }).category.id;

    const res = await adminReq('post', '/products').send({
      sku: `TST-${Date.now()}`,
      name: 'Orphan attempt',
      pricePaise: 100,
      stock: 1,
      categoryId,
    });
    expect(res.status).toBe(422);
    expect((res.body as { code: string }).code).toBe('CATEGORY_INACTIVE');
  });

  it('updates price with a before/after audit trail', async () => {
    const before = (await adminReq('get', '/products/p-tee')).body as {
      product: { price_paise: number };
    };
    const res = await adminReq('patch', '/products/p-tee').send({ pricePaise: 139900 });
    expect(res.status).toBe(200);
    expect((res.body as { product: { price_paise: number } }).product.price_paise).toBe(139900);

    const audit = auditFor('PRODUCT', 'p-tee', 'PRODUCT_UPDATED');
    expect(JSON.parse(audit?.previous_state ?? '{}').price_paise).toBe(before.product.price_paise);
    expect(JSON.parse(audit?.new_state ?? '{}').price_paise).toBe(139900);

    // Restore catalogue pricing so other suites see what they expect.
    await adminReq('patch', '/products/p-tee').send({ pricePaise: before.product.price_paise });
  });

  it('mirrors stock sets into the sellable bucket', async () => {
    const res = await adminReq('patch', '/products/p-denim').send({ stock: 42 });
    expect(res.status).toBe(200);
    const bucket = db
      .prepare("SELECT quantity FROM inventory_buckets WHERE warehouse_id = ? AND product_id = ? AND state = 'AVAILABLE'")
      .get(DEFAULT_WAREHOUSE_ID, 'p-denim') as { quantity: number };
    expect(bucket.quantity).toBe(42);
  });

  it('refuses to disable a product with open orders and returns, naming them', async () => {
    const sku = `TST-${Date.now()}`;
    const created = await adminReq('post', '/products').send({ sku, name: 'Busy Tee', pricePaise: 1000, stock: 5 });
    expect(created.status).toBe(201);
    const productId = (created.body as { product: { id: string } }).product.id;

    const product = db.prepare('SELECT sku, name, price_paise FROM products WHERE id = ?').get(productId) as {
      sku: string;
      name: string;
      price_paise: number;
    };
    const order = createOrder({
      orderNumber: `ORD-BUSY-${Date.now()}`,
      customerId: customer.user.id,
      status: 'PLACED',
      createdAt: daysAgoIso(1),
      deliveredAt: null,
      items: [{ productId, sku: product.sku, productName: product.name, quantity: 1, unitPrice: 10 }],
    });
    const detail = await request(app).get(`/api/v1/orders/${order.id}`).set('Authorization', `Bearer ${customer.token}`);
    const orderItemId = (detail.body as { items: Array<{ id: string }> }).items[0].id;
    // Delivered snapshot for the return path without touching the open order.
    db.prepare('UPDATE orders SET status = ?, delivered_at = ? WHERE id = ?').run('DELIVERED', daysAgoIso(0), order.id);
    const ret = await request(app)
      .post('/api/v1/returns')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        orderId: order.id,
        items: [{ orderItemId, quantity: 1, reasonCode: 'CHANGED_MIND' }],
        resolutionType: 'REFUND',
        pickupKind: 'PICKUP',
        pickupAddress: 'Home',
      });
    expect(ret.status).toBe(201);

    // Reopen the order so BOTH blockers are live at disable time.
    db.prepare("UPDATE orders SET status = 'PROCESSING' WHERE id = ?").run(order.id);

    const res = await adminReq('patch', `/products/${productId}`).send({ active: false });
    expect(res.status).toBe(409);
    const body = res.body as {
      code: string;
      errors: { openOrders: number; openReturns: number; orderNumbers: string[]; returnNumbers: string[] };
    };
    expect(body.code).toBe('PRODUCT_HAS_PENDING_TRANSACTIONS');
    expect(body.errors.openOrders).toBe(1);
    expect(body.errors.openReturns).toBe(1);
    expect(body.errors.orderNumbers.length).toBe(1);
    expect(body.errors.returnNumbers.length).toBe(1);

    const still = await adminReq('get', `/products/${productId}`);
    expect((still.body as { product: { active: number } }).product.active).toBe(1);
  });

  it('disables and re-enables a clean product', async () => {
    const sku = `TST-${Date.now()}-clean`;
    const created = await adminReq('post', '/products').send({ sku, name: 'Quiet Tee', pricePaise: 500, stock: 3 });
    const productId = (created.body as { product: { id: string } }).product.id;

    expect((await adminReq('patch', `/products/${productId}`).send({ active: false })).status).toBe(200);
    expect(((await adminReq('get', `/products/${productId}`)).body as { product: { active: number } }).product.active).toBe(0);
    expect((await adminReq('patch', `/products/${productId}`).send({ active: true })).status).toBe(200);
  });

  it('404s unknown products and fences customers off writes', async () => {
    expect((await adminReq('get', '/products/nope')).status).toBe(404);
    const customerPost = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ sku: 'X', name: 'Y', pricePaise: 1, stock: 1 });
    expect(customerPost.status).toBe(403);
    const customerCat = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ name: 'Sneaky' });
    expect(customerCat.status).toBe(403);
  });
});

function leaksCredentials(value: unknown): boolean {
  const text = JSON.stringify(value);
  return text.includes('password_hash') || text.includes('token_hash');
}
