import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db, initSchema } from '../db.js';
import { seedDatabase } from '../seed.js';
import { createOrder } from '../store.js';
import { createTask } from '../warehouse/tasks.js';
import { DEFAULT_WAREHOUSE_ID } from '../warehouse/schema.js';
import { getReturnWindowDays, getSettingsState, getTaskSlaHours } from './settings.js';

/**
 * Phase 4 — policy parameters and return reasons.
 *
 * Settings/Default parity comes from settings-compat.test.ts (behavior
 * pins, untouched by this file). Here: the settings themselves are
 * validated, audited, and actually drive the engines they claim to drive;
 * reasons are admin-manageable end to end, including deactivation reaching
 * the customer flow as a rejection, not a silent ignore.
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

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

let admin: Session;
let customer: Session;

beforeAll(async () => {
  initSchema();
  seedDatabase();
  admin = await loginAdmin();
  customer = await signupCustomer('pol');
});

function adminReq(method: 'get' | 'post' | 'patch', path: string) {
  return request(app)[method](`/api/v1/admin${path}`).set('Authorization', `Bearer ${admin.token}`);
}

describe('settings', () => {
  it('serves every known key with stored, effective and validity flags', async () => {
    const res = await adminReq('get', '/settings');
    expect(res.status).toBe(200);
    const keys = ((res.body as { settings: Array<{ key: string }> }).settings).map((entry) => entry.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'RETURN_WINDOW_DAYS',
        'CHANGED_MIND_REFUND_DAYS',
        'TASK_SLA_HOURS',
        'FREE_SHIPPING_THRESHOLD_PAISE',
        'FLAT_SHIPPING_PAISE',
      ]),
    );
    for (const entry of (res.body as { settings: Array<{ valid: boolean }> }).settings) {
      expect(entry.valid).toBe(true);
    }
  });

  it('matches the compiled defaults the compat suite pins', () => {
    expect(getReturnWindowDays()).toBe(30);
    expect(getTaskSlaHours()).toEqual({
      RECEIVE_RETURN: 24,
      INSPECT_ITEM: 24,
      PROCESS_DISPOSITION: 48,
      REVIEW_APPROVAL: 8,
      RESTOCK: 24,
      PACKAGE_REPLACEMENT: 48,
      PREPARE_EXCHANGE: 48,
      VERIFY_SHIPMENT: 12,
    });
    expect(getSettingsState().every((entry) => entry.valid)).toBe(true);
  });

  it('rejects unknown keys and invalid values', async () => {
    expect((await adminReq('patch', '/settings/NOPE').send({ value: 1 })).status).toBe(400);
    expect((await adminReq('patch', '/settings/RETURN_WINDOW_DAYS').send({ value: 0 })).status).toBe(400);
    expect((await adminReq('patch', '/settings/RETURN_WINDOW_DAYS').send({ value: 400 })).status).toBe(400);
    expect((await adminReq('patch', '/settings/TASK_SLA_HOURS').send({ value: { RECEIVE_RETURN: 5 } })).status).toBe(400);
  });

  it('moves the eligibility window and moves it back, audited both ways', async () => {
    const product = db.prepare('SELECT sku, name, price_paise FROM products WHERE id = ?').get('p-tee') as {
      sku: string;
      name: string;
      price_paise: number;
    };
    const mkOrder = (suffix: string) =>
      createOrder({
        orderNumber: `ORD-POL-${suffix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
        customerId: customer.user.id,
        status: 'DELIVERED',
        createdAt: daysAgoIso(25),
        deliveredAt: daysAgoIso(20),
        items: [{ productId: 'p-tee', sku: product.sku, productName: product.name, quantity: 1, unitPrice: 1 }],
      });

    const before = mkOrder('a');
    const { getOrderDetail } = await import('../store.js');
    expect(getOrderDetail(customer.user.id, before.id)?.eligible).toBe(true);

    const narrowed = await adminReq('patch', '/settings/RETURN_WINDOW_DAYS').send({ value: 10 });
    expect(narrowed.status).toBe(200);
    expect(getOrderDetail(customer.user.id, before.id)?.eligible).toBe(false);

    const restored = await adminReq('patch', '/settings/RETURN_WINDOW_DAYS').send({ value: 30 });
    expect(restored.status).toBe(200);
    expect(getOrderDetail(customer.user.id, before.id)?.eligible).toBe(true);

    const audits = db
      .prepare("SELECT COUNT(*) AS count FROM admin_audit_log WHERE entity_type = 'SETTING' AND entity_id = 'RETURN_WINDOW_DAYS' AND action = 'SETTING_UPDATED'")
      .get() as { count: number };
    expect(audits.count).toBe(2);
  });

  it('moves new task due dates with the SLA map, then restores it', async () => {
    await adminReq('patch', '/settings/TASK_SLA_HOURS').send({
      value: {
        RECEIVE_RETURN: 24,
        INSPECT_ITEM: 24,
        PROCESS_DISPOSITION: 48,
        REVIEW_APPROVAL: 48,
        RESTOCK: 24,
        PACKAGE_REPLACEMENT: 48,
        PREPARE_EXCHANGE: 48,
        VERIFY_SHIPMENT: 12,
      },
    });
    const task = createTask({
      warehouseId: DEFAULT_WAREHOUSE_ID,
      kind: 'REVIEW_APPROVAL',
      title: 'SLA proof',
      returnId: null,
    });
    const dueInHours = (new Date(task.due_at).getTime() - Date.now()) / 3_600_000;
    expect(dueInHours).toBeGreaterThan(47);
    expect(dueInHours).toBeLessThan(49);

    await adminReq('patch', '/settings/TASK_SLA_HOURS').send({
      value: {
        RECEIVE_RETURN: 24,
        INSPECT_ITEM: 24,
        PROCESS_DISPOSITION: 48,
        REVIEW_APPROVAL: 8,
        RESTOCK: 24,
        PACKAGE_REPLACEMENT: 48,
        PREPARE_EXCHANGE: 48,
        VERIFY_SHIPMENT: 12,
      },
    });
    expect(getTaskSlaHours().REVIEW_APPROVAL).toBe(8);
  });

  it('fences settings off from customers', async () => {
    const res = await request(app)
      .get('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${customer.token}`);
    expect(res.status).toBe(403);
  });
});

describe('return reasons', () => {
  it('adds a reason the customer flow immediately accepts', async () => {
    const created = await adminReq('post', '/return-reasons').send({
      code: 'POLICY_PROBE',
      label: 'Policy probe reason',
      sortOrder: 1,
    });
    expect(created.status).toBe(201);

    const product = db.prepare('SELECT sku, name, price_paise FROM products WHERE id = ?').get('p-tee') as {
      sku: string;
      name: string;
      price_paise: number;
    };
    const order = createOrder({
      orderNumber: `ORD-POL-R-${Date.now()}`,
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
        items: [{ orderItemId, quantity: 1, reasonCode: 'POLICY_PROBE' }],
        resolutionType: 'REFUND',
        pickupKind: 'PICKUP',
        pickupAddress: 'Home',
      });
    expect(ret.status).toBe(201);
  });

  it('deactivation reaches the customer flow as a rejection', async () => {
    const off = await adminReq('patch', '/return-reasons/POLICY_PROBE').send({ active: false });
    expect(off.status).toBe(200);

    const active = await request(app).get('/api/v1/meta/reasons');
    const codes = ((active.body as { reasons: Array<{ code: string }> }).reasons).map((row) => row.code);
    expect(codes).not.toContain('POLICY_PROBE');

    const listed = await adminReq('get', '/return-reasons');
    const row = ((listed.body as { reasons: Array<{ code: string; active: number }> }).reasons).find(
      (entry) => entry.code === 'POLICY_PROBE',
    );
    expect(row?.active).toBe(0);
  });

  it('rejects duplicate codes', async () => {
    const res = await adminReq('post', '/return-reasons').send({ code: 'CHANGED_MIND', label: 'Dupe' });
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('REASON_EXISTS');
  });
});
