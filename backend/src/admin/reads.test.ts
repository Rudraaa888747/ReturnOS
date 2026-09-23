import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db, initSchema } from '../db.js';
import { seedDatabase } from '../seed.js';

/**
 * Phase 2 — admin read layer.
 *
 * Every count is checked against a direct SQL query (live, never
 * hardcoded). Every response body is scanned for credential material:
 * the admin reads cross-customer data for the first time, so the suite
 * proves no endpoint leaks password hashes or reset tokens, rather than
 * trusting that customer query functions were safe to reuse.
 */

interface Session {
  token: string;
  user: { id: string; role: string };
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
    .send({
      email: `reads-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`,
      password: 'Password123',
      fullName: 'Reads Customer',
    });
  expect(res.status).toBe(201);
  return res.body as Session;
}

/** True when any credential material appears anywhere in a response body. */
function leaksCredentials(value: unknown): boolean {
  const text = JSON.stringify(value);
  return text.includes('password_hash') || text.includes('token_hash');
}

let admin: Session;
let customer: Session;

beforeAll(async () => {
  initSchema();
  seedDatabase();
  admin = await loginAdmin();
  customer = await signupCustomer();
});

function adminGet(path: string) {
  return request(app).get(`/api/v1/admin${path}`).set('Authorization', `Bearer ${admin.token}`);
}

describe('dashboard summary is live', () => {
  it('matches direct counts from the database', async () => {
    const res = await adminGet('/summary');
    expect(res.status).toBe(200);
    const body = res.body as {
      commerce: { totalOrders: number; deliveredOrders: number };
      returns: { totalReturns: number };
      customers: { totalCustomers: number };
      financial: { creditIssuedPaise: number };
    };
    expect(body.commerce.totalOrders).toBe(
      (db.prepare('SELECT COUNT(*) AS count FROM orders').get() as { count: number }).count,
    );
    expect(body.returns.totalReturns).toBe(
      (db.prepare('SELECT COUNT(*) AS count FROM returns').get() as { count: number }).count,
    );
    expect(body.customers.totalCustomers).toBe(
      (db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'CUSTOMER'").get() as { count: number }).count,
    );
    expect(body.financial.creditIssuedPaise).toBe(
      (db.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS total FROM store_credit_ledger WHERE type = 'CREDIT'").get() as {
        total: number;
      }).total,
    );
    expect(body.commerce.deliveredOrders).toBeGreaterThanOrEqual(3);
    expect(leaksCredentials(res.body)).toBe(false);
  });
});

describe('customers', () => {
  it('lists accounts with rollups and finds the seeded demo user', async () => {
    const res = await adminGet('/customers?sort=created_at&dir=asc');
    expect(res.status).toBe(200);
    const body = res.body as {
      customers: Array<{ id: string; email: string; orders_count: number }>;
      total: number;
    };
    expect(body.total).toBeGreaterThanOrEqual(2);
    const demo = body.customers.find((row) => row.email === 'rudrachokshi441@gmail.com');
    expect(demo?.orders_count).toBe(3);
    expect(leaksCredentials(res.body)).toBe(false);
  });

  it('searches and paginates', async () => {
    const search = await adminGet('/customers?search=rudrachokshi441');
    expect((search.body as { total: number }).total).toBe(1);
    const page = await adminGet('/customers?limit=1&offset=0');
    expect((page.body as { customers: unknown[] }).customers).toHaveLength(1);
  });

  it('shows the full customer file without credential fields', async () => {
    const res = await adminGet('/customers/u-demo-rudra');
    expect(res.status).toBe(200);
    const body = res.body as {
      user: { email: string; phone: string | null };
      orders: unknown[];
      returns: unknown[];
      credit: { balancePaise: number; history: unknown[] };
      tickets: unknown[];
      activity: unknown[];
    };
    expect(body.user.email).toBe('rudrachokshi441@gmail.com');
    expect(body.orders.length).toBe(3);
    expect(body.returns.length).toBeGreaterThanOrEqual(1);
    expect(leaksCredentials(res.body)).toBe(false);
  });

  it('404s unknown ids and non-customer roles', async () => {
    expect((await adminGet('/customers/nope')).status).toBe(404);
    expect((await adminGet('/customers/u-wh-operator')).status).toBe(404);
  });
});

describe('orders', () => {
  it('lists every order with its customer and filters by status', async () => {
    const all = await adminGet('/orders');
    expect(all.status).toBe(200);
    expect((all.body as { total: number }).total).toBeGreaterThanOrEqual(3);

    const delivered = await adminGet('/orders?status=DELIVERED');
    const rows = (delivered.body as { orders: Array<{ status: string }> }).orders;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.status).toBe('DELIVERED');
    }
    expect(leaksCredentials(all.body)).toBe(false);
  });

  it('shows the linkage web on one order', async () => {
    const res = await adminGet('/orders/o-2026-1001');
    expect(res.status).toBe(200);
    const body = res.body as {
      customer: { email: string };
      items: unknown[];
      events: unknown[];
      returns: Array<{ return_number: string }>;
    };
    expect(body.customer.email).toBe('rudrachokshi441@gmail.com');
    expect(body.items.length).toBeGreaterThan(0);
    expect(leaksCredentials(res.body)).toBe(false);
  });

  it('404s unknown orders and rejects bad dates', async () => {
    expect((await adminGet('/orders/nope')).status).toBe(404);
    expect((await adminGet('/orders?from=not-a-date')).status).toBe(400);
    expect((await adminGet('/orders?limit=0')).status).toBe(400);
  });
});

describe('returns', () => {
  it('lists the seeded return with its product summary', async () => {
    const res = await adminGet('/returns?status=REQUESTED');
    expect(res.status).toBe(200);
    const rows = (res.body as { returns: Array<{ return_number: string; product_name: string | null }> }).returns;
    const seeded = rows.find((row) => row.return_number === 'RET-2026-0841');
    expect(seeded?.product_name).toBe('Trail Hiking Shoes');
    expect(leaksCredentials(res.body)).toBe(false);
  });

  it('shows the complete lifecycle file with sealed storage paths', async () => {
    const res = await adminGet('/returns/r-2026-0841');
    expect(res.status).toBe(200);
    const body = res.body as {
      customer: { email: string };
      items: unknown[];
      events: unknown[];
      documents: Array<Record<string, unknown>>;
      audit: unknown[];
      refund: { status: string } | null;
    };
    expect(body.customer.email).toBe('rudrachokshi441@gmail.com');
    expect(body.items.length).toBe(1);
    expect(body.events.length).toBeGreaterThanOrEqual(1);
    expect(body.refund?.status).toBe('PENDING');
    for (const doc of body.documents) {
      expect(doc).not.toHaveProperty('storage_path');
    }
    expect(leaksCredentials(res.body)).toBe(false);
  });

  it('404s unknown returns', async () => {
    expect((await adminGet('/returns/nope')).status).toBe(404);
  });
});

describe('warehouses, workload, inventory, analytics', () => {
  it('rolls every site up with live counts', async () => {
    const res = await adminGet('/warehouses');
    expect(res.status).toBe(200);
    const rows = (res.body as { warehouses: Array<{ code: string; operators: number }> }).warehouses;
    expect(rows.some((row) => row.code === 'BLR-01' && row.operators >= 1)).toBe(true);
    expect(leaksCredentials(res.body)).toBe(false);
  });

  it('lists operators without credential fields', async () => {
    const res = await adminGet('/warehouse-users');
    expect(res.status).toBe(200);
    const rows = (res.body as { users: Array<{ email: string }> }).users;
    expect(rows.some((row) => row.email === 'warehouse@returnos.test')).toBe(true);
    expect(leaksCredentials(res.body)).toBe(false);
  });

  it('shows cross-site workload and global inventory', async () => {
    const workload = await adminGet('/workload?limit=5');
    expect(workload.status).toBe(200);
    expect(workload.body).toMatchObject({
      returns: expect.any(Array),
      returnsTotal: expect.any(Number),
      tasks: expect.any(Array),
      tasksTotal: expect.any(Number),
    });

    const inventory = await adminGet('/inventory?limit=5');
    expect(inventory.status).toBe(200);
    expect((inventory.body as { total: number }).total).toBeGreaterThanOrEqual(5);

    const movements = await adminGet('/inventory/movements?limit=5');
    expect(movements.status).toBe(200);

    const analytics = await adminGet('/analytics?windowDays=30');
    expect(analytics.status).toBe(200);
    expect((analytics.body as { scope: string }).scope).toBe('global');
    for (const body of [workload.body, inventory.body, movements.body, analytics.body]) {
      expect(leaksCredentials(body)).toBe(false);
    }
  });
});

describe('read endpoints stay fenced', () => {
  it('rejects customers on every new read route with 403', async () => {
    for (const path of [
      '/summary',
      '/customers',
      '/customers/u-demo-rudra',
      '/orders',
      '/orders/o-2026-1001',
      '/returns',
      '/returns/r-2026-0841',
      '/warehouses',
      '/warehouse-users',
      '/workload',
      '/inventory',
      '/inventory/movements',
      '/analytics',
    ]) {
      const res = await request(app)
        .get(`/api/v1/admin${path}`)
        .set('Authorization', `Bearer ${customer.token}`);
      expect(res.status, path).toBe(403);
    }
  });
});
