import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './app.js';
import { db, initSchema } from './db.js';
import { seedDatabase } from './seed.js';
import { createOrder } from './store.js';
import { tickFulfillment } from './fulfillment.js';

/**
 * The scheduler owns the carrier legs and nothing past them: orders run to
 * DELIVERED, returns stop at IN_TRANSIT where the warehouse takes over.
 * This pins that boundary so a future scheduler change cannot silently
 * reintroduce auto-receiving or auto-resolution (the Phase 1 race).
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

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

beforeAll(() => {
  initSchema();
  seedDatabase();
});

/** Step a return forward until it reaches `status`, like the carrier would. */
function advanceReturn(returnId: string, status: string): void {
  for (let tick = 0; tick < 10; tick += 1) {
    const current = db.prepare('SELECT status FROM returns WHERE id = ?').get(returnId) as { status: string };
    if (current.status === status) return;
    db.prepare('UPDATE returns SET updated_at = ? WHERE id = ?').run(daysAgoIso(1), returnId);
    tickFulfillment();
  }
  const current = db.prepare('SELECT status FROM returns WHERE id = ?').get(returnId) as { status: string };
  expect(current.status).toBe(status);
}

describe('scheduler handover boundary', () => {
  it('never advances a return past IN_TRANSIT', async () => {
    const customer = await signupCustomer('sched-bound');
    const product = db.prepare('SELECT sku, name, price_paise FROM products WHERE id = ?').get('p-tee') as {
      sku: string;
      name: string;
      price_paise: number;
    };
    const order = createOrder({
      orderNumber: `ORD-SCH-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      customerId: customer.user.id,
      status: 'DELIVERED',
      createdAt: daysAgoIso(5),
      deliveredAt: daysAgoIso(2),
      items: [
        {
          productId: 'p-tee',
          sku: product.sku,
          productName: product.name,
          quantity: 1,
          unitPrice: product.price_paise / 100,
        },
      ],
    });
    const detail = await request(app)
      .get(`/api/v1/orders/${order.id}`)
      .set('Authorization', `Bearer ${customer.token}`);
    const orderItemId = (detail.body as { items: Array<{ id: string }> }).items[0].id;
    const created = await request(app)
      .post('/api/v1/returns')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        orderId: order.id,
        items: [{ orderItemId, quantity: 1, reasonCode: 'CHANGED_MIND' }],
        resolutionType: 'REFUND',
        pickupKind: 'PICKUP',
        pickupAddress: 'Home',
      });
    expect(created.status).toBe(201);
    const returnId = (created.body as { ret: { id: string } }).ret.id;

    advanceReturn(returnId, 'IN_TRANSIT');

    // Keep ticking with an overdue clock: nothing past the handover may move.
    for (let tick = 0; tick < 3; tick += 1) {
      db.prepare('UPDATE returns SET updated_at = ? WHERE id = ?').run(daysAgoIso(1), returnId);
      tickFulfillment();
    }
    const final = db.prepare('SELECT status, approved_at FROM returns WHERE id = ?').get(returnId) as {
      status: string;
      approved_at: string | null;
    };
    expect(final.status).toBe('IN_TRANSIT');
    expect(final.approved_at).not.toBeNull();
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM receiving_records WHERE return_id = ?').get(returnId) as {
        count: number;
      }).count,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM return_events WHERE return_id = ? AND status = 'RESOLVED'").get(returnId) as {
        count: number;
      }).count,
    ).toBe(0);
  });

  it('still advances orders while returns wait at the handover', async () => {
    const customer = await signupCustomer('sched-ord');
    const product = db.prepare('SELECT sku, name, price_paise FROM products WHERE id = ?').get('p-tee') as {
      sku: string;
      name: string;
      price_paise: number;
    };
    const order = createOrder({
      orderNumber: `ORD-SCHP-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      customerId: customer.user.id,
      status: 'PLACED',
      createdAt: daysAgoIso(5),
      deliveredAt: null,
      items: [
        {
          productId: 'p-tee',
          sku: product.sku,
          productName: product.name,
          quantity: 1,
          unitPrice: product.price_paise / 100,
        },
      ],
    });
    db.prepare('UPDATE orders SET created_at = ? WHERE id = ?').run(daysAgoIso(1), order.id);
    tickFulfillment();
    const row = db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id) as { status: string };
    expect(row.status).toBe('CONFIRMED');
  });
});
