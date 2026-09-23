import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db, initSchema } from '../db.js';
import { seedDatabase } from '../seed.js';
import { createOrder } from '../store.js';
import { queueEntry } from './queue.js';
import { DEFAULT_WAREHOUSE_ID } from './schema.js';

interface Session {
  token: string;
  user: { id: string };
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

beforeAll(async () => {
  initSchema();
  seedDatabase();
});

describe('queue customer references', () => {
  it('renders as CUS- plus six alphanumerics, never a double dash', async () => {
    // A customer id ending in a separator (like the demo `u-demo-rudra`)
    // used to render as `CUS--RUDRA`.
    const signup = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        email: `queue-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`,
        password: 'Password123',
        fullName: 'Queue Customer',
      });
    expect(signup.status).toBe(201);
    const customer = signup.body as Session;

    const product = db.prepare('SELECT sku, name, price_paise FROM products WHERE id = ?').get('p-tee') as {
      sku: string;
      name: string;
      price_paise: number;
    };
    const order = createOrder({
      orderNumber: `ORD-Q-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
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

    expect(queueEntry(returnId, DEFAULT_WAREHOUSE_ID).customerRef).toMatch(/^CUS-[A-Z0-9]{6}$/);
  });
});
