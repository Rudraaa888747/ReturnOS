import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db, initSchema } from '../db.js';
import { seedDatabase } from '../seed.js';
import { createOrder } from '../store.js';

/**
 * Phase 6 — admin user management endpoints and customer disable.
 *
 * Guard branches themselves were proven first in guards.test.ts (pure
 * unit tests, no HTTP). Here the endpoints are proven to enforce them:
 * self-disable, last-admin demotion, non-last changes, and a banned
 * customer whose open return still resolves normally through the floor.
 */

interface Session {
  token: string;
  user: { id: string };
}

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

async function loginAdmin(): Promise<Session> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@returnos.test', password: 'Admin123' });
  expect(res.status).toBe(200);
  return res.body as Session;
}

async function loginAs(email: string, password: string) {
  return request(app).post('/api/v1/auth/login').send({ email, password });
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

let admin: Session;

beforeAll(async () => {
  initSchema();
  seedDatabase();
  admin = await loginAdmin();
});

function adminReq(method: 'get' | 'post' | 'patch', path: string) {
  return request(app)[method](`/api/v1/admin${path}`).set('Authorization', `Bearer ${admin.token}`);
}

describe('admin users', () => {
  it('lists admins and creates one that can sign in', async () => {
    const list = await adminReq('get', '/users');
    expect(list.status).toBe(200);
    expect(
      ((list.body as { users: Array<{ email: string }> }).users).some((row) => row.email === 'admin@returnos.test'),
    ).toBe(true);

    const email = uniqueEmail('ops');
    const created = await adminReq('post', '/users').send({
      email,
      password: 'Operator123',
      fullName: 'Ops Admin',
    });
    expect(created.status).toBe(201);
    const id = (created.body as { user: { id: string } }).user.id;

    const login = await loginAs(email, 'Operator123');
    expect(login.status).toBe(200);
    expect((login.body as { user: { role: string } }).user.role).toBe('ADMIN');

    const dup = await adminReq('post', '/users').send({ email, password: 'Operator123', fullName: 'Dupe' });
    expect(dup.status).toBe(409);

    // Cleanup: a second admin demotes cleanly while the seed admin remains.
    const demoted = await adminReq('patch', `/users/${id}`).send({ role: 'CUSTOMER' });
    expect(demoted.status).toBe(200);
    expect((demoted.body as { user: { role: string } }).user.role).toBe('CUSTOMER');
  });

  it('refuses self-disable with a named error and touches nothing', async () => {
    const me = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@returnos.test') as { id: string };
    const res = await adminReq('patch', `/users/${me.id}`).send({ active: false });
    expect(res.status).toBe(403);
    expect((res.body as { code: string }).code).toBe('ADMIN_SELF_LOCKOUT');
    expect(
      (db.prepare('SELECT active FROM users WHERE id = ?').get(me.id) as { active: number }).active,
    ).toBe(1);
  });

  it('refuses to demote yourself even when other admins exist', async () => {
    const me = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@returnos.test') as { id: string };
    const res = await adminReq('patch', `/users/${me.id}`).send({ role: 'CUSTOMER' });
    expect(res.status).toBe(403);
    expect((res.body as { code: string }).code).toBe('ADMIN_SELF_LOCKOUT');
  });

  it('edits names and toggles activity on other admins', async () => {
    const email = uniqueEmail('rename');
    const created = await adminReq('post', '/users').send({ email, password: 'Operator123', fullName: 'Old Name' });
    const id = (created.body as { user: { id: string } }).user.id;

    expect((await adminReq('patch', `/users/${id}`).send({ fullName: 'New Name' })).status).toBe(200);
    expect((await adminReq('patch', `/users/${id}`).send({ active: false })).status).toBe(200);
    expect((await loginAs(email, 'Operator123')).status).toBe(403);
    expect((await adminReq('patch', `/users/${id}`).send({ active: true })).status).toBe(200);
    expect((await loginAs(email, 'Operator123')).status).toBe(200);
  });

  it('404s unknown users and 422s out-of-scope roles', async () => {
    expect((await adminReq('patch', '/users/nope').send({ active: false })).status).toBe(404);
    const scoped = await adminReq('patch', '/users/u-wh-operator').send({ active: false });
    expect(scoped.status).toBe(422);
    expect((scoped.body as { code: string }).code).toBe('ROLE_NOT_MANAGED');
  });

  it('fences user management off from customers', async () => {
    const customer = await signupCustomer('fence');
    const res = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${customer.token}`);
    expect(res.status).toBe(403);
  });
});

describe('customer disable', () => {
  it('bans access but lets the open return resolve normally', async () => {
    const customer = await signupCustomer('banned');
    const product = db.prepare('SELECT sku, name, price_paise FROM products WHERE id = ?').get('p-tee') as {
      sku: string;
      name: string;
      price_paise: number;
    };
    const order = createOrder({
      orderNumber: `ORD-BAN-${Date.now()}`,
      customerId: customer.user.id,
      status: 'DELIVERED',
      createdAt: daysAgoIso(5),
      deliveredAt: daysAgoIso(2),
      items: [{ productId: 'p-tee', sku: product.sku, productName: product.name, quantity: 1, unitPrice: 1 }],
    });
    const detail = await request(app)
      .get(`/api/v1/orders/${order.id}`)
      .set('Authorization', `Bearer ${customer.token}`);
    const orderItemId = (detail.body as { items: Array<{ id: string }> }).items[0].id;
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
    const returnId = (ret.body as { ret: { id: string } }).ret.id;
    const returnItemId = (db.prepare('SELECT id FROM return_items WHERE return_id = ?').get(returnId) as { id: string }).id;

    // The ban lands despite the open return — and names no blockers.
    const banned = await adminReq('patch', `/customers/${customer.user.id}`).send({ active: false });
    expect(banned.status).toBe(200);

    // Session and login die with the ban.
    const customerEmail = (db.prepare('SELECT email FROM users WHERE id = ?').get(customer.user.id) as { email: string }).email;
    const relogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: customerEmail, password: 'Password123' });
    expect(relogin.status).toBe(403);
    expect((relogin.body as { code: string }).code).toBe('ACCOUNT_DISABLED');
    const staleCall = await request(app)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${customer.token}`);
    expect(staleCall.status).toBe(403);

    // The floor never consults customer active status: the return resolves.
    const warehouse = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'warehouse@returnos.test', password: 'Warehouse123' });
    const wToken = (warehouse.body as Session).token;
    const wh = (method: 'get' | 'post', path: string) =>
      request(app)[method](`/api/v1/warehouse${path}`).set('Authorization', `Bearer ${wToken}`);
    expect((await wh('post', `/returns/${returnId}/approve`).send({})).status).toBe(200);
    expect(
      (await wh('post', `/returns/${returnId}/receive`).send({ packageCondition: 'SEALED', receivedQuantity: 1 })).status,
    ).toBe(201);
    expect((await wh('post', `/returns/${returnId}/inspection/start`).send({})).status).toBe(201);
    expect(
      (await wh('post', `/returns/${returnId}/inspection/complete`).send({
        findings: [{ returnItemId, result: 'PASS', productCondition: 'LIKE_NEW', packagingCondition: 'NEW', quantity: 1 }],
      })).status,
    ).toBe(200);
    const disposed = await wh('post', `/returns/${returnId}/disposition`).send({
      returnItemId,
      action: 'RESTOCK',
      quantity: 1,
    });
    expect(disposed.status).toBe(201);
    expect((disposed.body as { returnResolved: boolean }).returnResolved).toBe(true);
    expect(
      (db.prepare('SELECT status FROM returns WHERE id = ?').get(returnId) as { status: string }).status,
    ).toBe('RESOLVED');

    // Re-enable for a clean ledger of states.
    expect((await adminReq('patch', `/customers/${customer.user.id}`).send({ active: true })).status).toBe(200);
  });

  it('404s unknown ids and non-customers', async () => {
    expect((await adminReq('patch', '/customers/nope').send({ active: false })).status).toBe(404);
    expect((await adminReq('patch', '/customers/u-wh-operator').send({ active: false })).status).toBe(404);
  });
});
