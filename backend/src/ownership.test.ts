import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './app.js';
import { initSchema } from './db.js';
import { createOrder, getOrderDetail } from './store.js';

interface SessionBody {
  token: string;
  user: { id: string; email: string };
}

interface ReturnDetailBody {
  ret: { id: string; return_number: string };
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

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

let customerA: SessionBody;
let customerB: SessionBody;
let orderIdA = '';
let orderItemIdA = '';
let returnIdA = '';
let returnNumberA = '';

beforeAll(async () => {
  initSchema();
  customerA = await signupCustomer('owner-a');
  customerB = await signupCustomer('owner-b');

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const order = createOrder({
    orderNumber: `ORD-TEST-${stamp}`,
    customerId: customerA.user.id,
    status: 'DELIVERED',
    createdAt: daysAgoIso(10),
    deliveredAt: daysAgoIso(5),
    items: [
      { productId: 'p-widget', sku: `WDG-${stamp}`, productName: 'Test Widget', quantity: 2, unitPrice: 750 },
    ],
  });
  orderIdA = order.id;
  const detail = getOrderDetail(customerA.user.id, orderIdA);
  if (detail === null || detail.items.length === 0) {
    throw new Error('Test order was not created correctly');
  }
  orderItemIdA = detail.items[0].id;

  const created = await request(app)
    .post('/api/v1/returns')
    .set('Authorization', `Bearer ${customerA.token}`)
    .send({
      orderId: orderIdA,
      items: [{ orderItemId: orderItemIdA, quantity: 1, reasonCode: 'OTHER' }],
      resolutionType: 'REFUND',
      description: 'Ownership test return',
      pickupKind: 'PICKUP',
    });
  expect(created.status).toBe(201);
  const body = created.body as ReturnDetailBody;
  returnIdA = body.ret.id;
  returnNumberA = body.ret.return_number;
});

describe('cross-customer ownership isolation', () => {
  it('hides customer A orders from customer B with 404', async () => {
    const res = await request(app)
      .get(`/api/v1/orders/${orderIdA}`)
      .set('Authorization', `Bearer ${customerB.token}`);
    expect(res.status).toBe(404);
  });

  it('hides customer A returns from customer B with 404', async () => {
    const res = await request(app)
      .get(`/api/v1/returns/${returnIdA}`)
      .set('Authorization', `Bearer ${customerB.token}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for tracking lookups by a non-owner', async () => {
    const res = await request(app)
      .get(`/api/v1/tracking/${returnNumberA}`)
      .set('Authorization', `Bearer ${customerB.token}`);
    expect(res.status).toBe(404);
    expect((res.body as { code: string }).code).toBe('TRACKING_NOT_FOUND');
  });

  it('serves tracking to the owning customer', async () => {
    const res = await request(app)
      .get(`/api/v1/tracking/${returnNumberA}`)
      .set('Authorization', `Bearer ${customerA.token}`);
    expect(res.status).toBe(200);
  });

  it('hides customer A documents from customer B with 404', async () => {
    const upload = await request(app)
      .post(`/api/v1/uploads/return/${returnIdA}`)
      .set('Authorization', `Bearer ${customerA.token}`)
      .attach('file', Buffer.from('ownership-evidence-bytes'), {
        filename: 'evidence.png',
        contentType: 'image/png',
      });
    expect(upload.status).toBe(201);
    const documentId = (upload.body as { document: { id: string } }).document.id;

    const foreign = await request(app)
      .get(`/api/v1/documents/${documentId}/download`)
      .set('Authorization', `Bearer ${customerB.token}`);
    expect(foreign.status).toBe(404);

    const own = await request(app)
      .get(`/api/v1/documents/${documentId}/download`)
      .set('Authorization', `Bearer ${customerA.token}`);
    expect(own.status).toBe(200);
  });

  it('hides customer A support tickets from customer B with 404', async () => {
    const created = await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ subject: 'Where is my pickup?', body: 'Pickup has not arrived yet.', returnId: returnIdA });
    expect(created.status).toBe(201);
    const ticketId = (created.body as { ticket: { id: string } }).ticket.id;

    const foreignGet = await request(app)
      .get(`/api/v1/support/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${customerB.token}`);
    expect(foreignGet.status).toBe(404);

    const foreignMessage = await request(app)
      .post(`/api/v1/support/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${customerB.token}`)
      .send({ body: 'Trying to hijack this ticket.' });
    expect(foreignMessage.status).toBe(404);
  });
});

describe('return creation validation', () => {
  it('rejects quantities above the remaining quantity with 422', async () => {
    const res = await request(app)
      .post('/api/v1/returns')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({
        orderId: orderIdA,
        items: [{ orderItemId: orderItemIdA, quantity: 99, reasonCode: 'OTHER' }],
        resolutionType: 'REFUND',
        pickupKind: 'PICKUP',
      });
    expect(res.status).toBe(422);
    expect((res.body as { code: string }).code).toBe('QUANTITY_EXCEEDS_REMAINING');
  });

  it('rejects unknown reason codes with 422', async () => {
    const res = await request(app)
      .post('/api/v1/returns')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({
        orderId: orderIdA,
        items: [{ orderItemId: orderItemIdA, quantity: 1, reasonCode: 'NO_SUCH_REASON' }],
        resolutionType: 'REFUND',
        pickupKind: 'PICKUP',
      });
    expect(res.status).toBe(422);
  });

  it('rejects malformed payloads with 400', async () => {
    const res = await request(app)
      .post('/api/v1/returns')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ orderId: orderIdA, items: [], resolutionType: 'REFUND', pickupKind: 'PICKUP' });
    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('rejects feedback duplicates with 409', async () => {
    const first = await request(app)
      .post('/api/v1/feedback')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ returnId: returnIdA, rating: 5, comment: 'Smooth process.' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/feedback')
      .set('Authorization', `Bearer ${customerA.token}`)
      .send({ returnId: returnIdA, rating: 4 });
    expect(second.status).toBe(409);
  });
});
