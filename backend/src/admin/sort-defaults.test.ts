import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db, initSchema } from '../db.js';
import { app } from '../app.js';
import { seedDatabase } from '../seed.js';
import { createOrder } from '../store.js';
import { sortDir } from './readers.js';

/**
 * Default ordering of the admin lists.
 *
 * Found in Phase 9: the orders list defaulted to oldest-first, so an admin
 * opening the page saw the seed data and not the order that had just been
 * placed. Anyone looking at a list of orders, returns or customers is asking
 * what is happening now, so those default to newest-first. Alphabetical lists
 * are unaffected.
 */

interface Session {
  token: string;
  user: { id: string };
}

let admin: Session;
let newestOrderNumber = '';

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

beforeAll(async () => {
  initSchema();
  seedDatabase();

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@returnos.test', password: 'Admin123' });
  expect(login.status).toBe(200);
  admin = login.body as Session;

  const customer = db.prepare("SELECT id FROM users WHERE role = 'CUSTOMER' LIMIT 1").get() as { id: string };
  const product = db.prepare("SELECT sku, name, price_paise FROM products WHERE id = 'p-tee'").get() as {
    sku: string;
    name: string;
    price_paise: number;
  };

  // An old order and a brand new one, so ordering is unambiguous.
  createOrder({
    orderNumber: 'ORD-SORT-OLD',
    customerId: customer.id,
    status: 'DELIVERED',
    createdAt: daysAgoIso(120),
    deliveredAt: daysAgoIso(118),
    items: [
      { productId: 'p-tee', sku: product.sku, productName: product.name, quantity: 1, unitPrice: product.price_paise / 100 },
    ],
  });
  newestOrderNumber = 'ORD-SORT-NEW';
  createOrder({
    orderNumber: newestOrderNumber,
    customerId: customer.id,
    status: 'PLACED',
    createdAt: new Date().toISOString(),
    items: [
      { productId: 'p-tee', sku: product.sku, productName: product.name, quantity: 1, unitPrice: product.price_paise / 100 },
    ],
  });
});

function get(path: string) {
  return request(app).get(`/api/v1/admin${path}`).set('Authorization', `Bearer ${admin.token}`);
}

describe('sortDir', () => {
  it('honours an explicit direction', () => {
    expect(sortDir('desc')).toBe('DESC');
    expect(sortDir('DESC')).toBe('DESC');
    expect(sortDir('asc', 'DESC')).toBe('ASC');
  });

  it('falls back to the caller default when nothing is asked for', () => {
    expect(sortDir(undefined)).toBe('ASC');
    expect(sortDir(undefined, 'DESC')).toBe('DESC');
    expect(sortDir('', 'DESC')).toBe('DESC');
  });

  it('never lets anything else reach SQL', () => {
    // A sort direction is interpolated into the query, so only these two
    // values may ever come out of here.
    for (const nasty of ['ASC; DROP TABLE users', '1=1', null, 42, {}, []]) {
      expect(['ASC', 'DESC']).toContain(sortDir(nasty, 'DESC'));
    }
  });
});

describe('admin list defaults', () => {
  it('shows the newest order first', async () => {
    const res = await get('/orders?limit=5');
    expect(res.status).toBe(200);
    const orders = (res.body as { orders: Array<{ order_number: string }> }).orders;
    expect(orders.length).toBeGreaterThan(0);
    expect(orders[0].order_number, 'the most recent order must lead the list').toBe(newestOrderNumber);
  });

  it('shows the newest return first', async () => {
    const res = await get('/returns?limit=5');
    expect(res.status).toBe(200);
    const returns = (res.body as { returns: Array<{ created_at: string }> }).returns;
    if (returns.length < 2) return;
    const dates = returns.map((row) => new Date(row.created_at).getTime());
    expect(dates, 'returns should descend by date').toEqual([...dates].sort((a, b) => b - a));
  });

  it('shows the newest customer first', async () => {
    const res = await get('/customers?limit=10');
    expect(res.status).toBe(200);
    const customers = (res.body as { customers: Array<{ created_at: string }> }).customers;
    if (customers.length < 2) return;
    const dates = customers.map((row) => new Date(row.created_at).getTime());
    expect(dates, 'customers should descend by date').toEqual([...dates].sort((a, b) => b - a));
  });

  it('still sorts products alphabetically ascending', async () => {
    const res = await get('/products?limit=20');
    expect(res.status).toBe(200);
    const products = (res.body as { products: Array<{ name: string }> }).products;
    if (products.length < 2) return;
    const names = products.map((row) => row.name);
    expect(names, 'an alphabetical list should stay ascending').toEqual(
      [...names].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('lets an explicit ascending request override the default', async () => {
    const res = await get('/orders?limit=5&dir=asc');
    expect(res.status).toBe(200);
    const orders = (res.body as { orders: Array<{ order_number: string }> }).orders;
    expect(orders[0].order_number, 'an explicit dir=asc must still work').not.toBe(newestOrderNumber);
  });
});
