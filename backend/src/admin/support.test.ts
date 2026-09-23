import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db, initSchema } from '../db.js';
import { seedDatabase } from '../seed.js';
import { migrateSupportAuthorRole } from './schema.js';
import { renderNotificationTemplate } from './notifications.js';

/**
 * Phase 6 — support conversations, notification templates, and CSV reports.
 *
 * Admin replies are authored as ADMIN (never relabelled), every admin move
 * notifies the customer through a template with a literal fallback, and
 * exports stream the same authorized readers the JSON endpoints serve.
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

let admin: Session;
let customer: Session;
let ticketId = '';
let ticketNumber = '';

beforeAll(async () => {
  initSchema();
  seedDatabase();
  admin = await loginAdmin();
  customer = await signupCustomer('sup');

  const created = await request(app)
    .post('/api/v1/support/tickets')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ subject: 'Where is my parcel', body: 'It has been a week.' });
  expect(created.status).toBe(201);
  ticketId = (created.body as { ticket: { id: string; ticket_number: string } }).ticket.id;
  ticketNumber = (created.body as { ticket: { id: string; ticket_number: string } }).ticket.ticket_number;
});

function adminReq(method: 'get' | 'post' | 'patch' | 'put', path: string) {
  return request(app)[method](`/api/v1/admin${path}`).set('Authorization', `Bearer ${admin.token}`);
}

describe('support tickets', () => {
  it('lists globally with search and shows the conversation', async () => {
    const list = await adminReq('get', '/support/tickets?search=parcel');
    expect(list.status).toBe(200);
    expect(
      ((list.body as { tickets: Array<{ id: string }> }).tickets).some((row) => row.id === ticketId),
    ).toBe(true);

    const detail = await adminReq('get', `/support/tickets/${ticketId}`);
    expect(detail.status).toBe(200);
    expect((detail.body as { messages: Array<{ author_role: string }> }).messages[0].author_role).toBe('CUSTOMER');
    expect((detail.body as { ticket: { customer_email: string } }).ticket.customer_email).toContain('@example.com');
  });

  it('assigns to staff, never to customers or ghosts', async () => {
    const op = db.prepare("SELECT id FROM users WHERE email = 'warehouse@returnos.test'").get() as { id: string };
    const assigned = await adminReq('patch', `/support/tickets/${ticketId}`).send({ assignedTo: op.id });
    expect(assigned.status).toBe(200);
    expect((assigned.body as { ticket: { assigned_to: string } }).ticket.assigned_to).toBe(op.id);

    const badRole = await adminReq('patch', `/support/tickets/${ticketId}`).send({ assignedTo: customer.user.id });
    expect(badRole.status).toBe(422);
    expect((badRole.body as { code: string }).code).toBe('ASSIGNEE_INVALID');

    const ghost = await adminReq('patch', `/support/tickets/${ticketId}`).send({ assignedTo: 'u-nope' });
    expect(ghost.status).toBe(422);
  });

  it('sets priority, audited', async () => {
    expect((await adminReq('patch', `/support/tickets/${ticketId}`).send({ priority: 'HIGH' })).status).toBe(200);
    const audit = db
      .prepare("SELECT COUNT(*) AS count FROM admin_audit_log WHERE entity_id = ? AND action = 'TICKET_PRIORITY_SET'")
      .get(ticketId) as { count: number };
    expect(audit.count).toBe(1);
  });

  it('replies as ADMIN and notifies through the template', async () => {
    const res = await adminReq('post', `/support/tickets/${ticketId}/messages`).send({
      body: 'Your parcel ships tomorrow morning.',
    });
    expect(res.status).toBe(201);

    const stored = db
      .prepare('SELECT author_role FROM support_messages WHERE id = ?')
      .get((res.body as { message: { id: string } }).message.id) as { author_role: string };
    expect(stored.author_role).toBe('ADMIN');

    const notice = db
      .prepare('SELECT title FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1')
      .get(customer.user.id) as { title: string };
    expect(notice.title).toContain(ticketNumber);
  });

  it('falls back to literals when the template is disabled', async () => {
    expect((await adminReq('put', '/notifications/templates/TICKET_REPLIED').send({
      title: 'X',
      body: 'Y',
      active: false,
    })).status).toBe(200);

    await adminReq('post', `/support/tickets/${ticketId}/messages`).send({ body: 'Second update.' });
    const notice = db
      .prepare('SELECT title FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1')
      .get(customer.user.id) as { title: string };
    expect(notice.title).toBe('New reply on your support ticket');

    expect((await adminReq('put', '/notifications/templates/TICKET_REPLIED').send({
      title: 'New reply on ticket {{ticket_number}}',
      body: 'Support replied to your ticket {{ticket_number}}. Open it to read the response.',
      active: true,
    })).status).toBe(200);
  });

  it('closes, refuses replies while closed, and reopens', async () => {
    expect((await adminReq('patch', `/support/tickets/${ticketId}`).send({ status: 'CLOSED' })).status).toBe(200);
    const shut = await adminReq('post', `/support/tickets/${ticketId}/messages`).send({ body: 'Too late.' });
    expect(shut.status).toBe(409);
    expect((await adminReq('patch', `/support/tickets/${ticketId}`).send({ status: 'OPEN' })).status).toBe(200);
  });

  it('404s unknown tickets and fences customers off', async () => {
    expect((await adminReq('get', '/support/tickets/nope')).status).toBe(404);
    const res = await request(app)
      .get('/api/v1/admin/support/tickets')
      .set('Authorization', `Bearer ${customer.token}`);
    expect(res.status).toBe(403);
  });

  it('widens the author check without losing existing rows', () => {
    db.exec('DROP TABLE support_messages');
    db.exec(`
      CREATE TABLE support_messages (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        author_role TEXT NOT NULL CHECK (author_role IN ('CUSTOMER', 'SYSTEM')),
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_ticket ON support_messages(ticket_id);
    `);
    db.prepare("INSERT INTO support_messages (id, ticket_id, author_role, body, created_at) VALUES ('m-old', ?, 'CUSTOMER', 'old', ?)")
      .run(ticketId, new Date().toISOString());

    migrateSupportAuthorRole();

    expect(
      (db.prepare("SELECT body FROM support_messages WHERE id = 'm-old'").get() as { body: string }).body,
    ).toBe('old');
    db.prepare("INSERT INTO support_messages (id, ticket_id, author_role, body, created_at) VALUES ('m-new', ?, 'ADMIN', 'new', ?)")
      .run(ticketId, new Date().toISOString());
    const check = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'support_messages'").get() as {
      sql: string;
    };
    expect(check.sql).toContain("'ADMIN'");
  });
});

describe('notifications and templates', () => {
  it('inspects global activity with filters', async () => {
    const all = await adminReq('get', '/notifications?limit=5');
    expect(all.status).toBe(200);
    expect((all.body as { total: number }).total).toBeGreaterThanOrEqual(1);

    const mine = await adminReq('get', `/notifications?userId=${customer.user.id}`);
    expect((mine.body as { notifications: Array<{ user_email: string }> }).notifications.length).toBeGreaterThan(0);
    expect(JSON.stringify(mine.body).includes('password_hash')).toBe(false);
  });

  it('manages templates with validation', async () => {
    const put = await adminReq('put', '/notifications/templates/PROBE_KEY').send({
      title: 'Hello {{name}}',
      body: 'Body {{name}} here.',
    });
    expect(put.status).toBe(200);

    const list = await adminReq('get', '/notifications/templates');
    expect(
      ((list.body as { templates: Array<{ key: string }> }).templates).some((row) => row.key === 'PROBE_KEY'),
    ).toBe(true);

    expect((await adminReq('put', '/notifications/templates/bad key!').send({ title: 'x', body: 'y' })).status).toBe(400);
    expect((await adminReq('put', '/notifications/templates/PROBE_KEY').send({ title: '', body: 'y' })).status).toBe(400);
  });

  it('renders variables and leaves unknown ones intact', async () => {
    const { renderNotificationTemplate } = await import('./notifications.js');
    expect(renderNotificationTemplate({ title: 'Hi {{name}}', body: 'A {{x}} B' }, { name: 'R' })).toEqual({
      title: 'Hi R',
      body: 'A {{x}} B',
    });
  });
});

describe('reports', () => {
  it('exports CSVs with headers matching list totals', async () => {
    const orders = await adminReq('get', '/reports/orders.csv');
    expect(orders.status).toBe(200);
    expect(orders.headers['content-type']).toContain('text/csv');
    expect(orders.headers['content-disposition']).toContain('attachment');
    const lines = (orders.text as string).trim().split('\r\n');
    expect(lines[0]).toBe(
      'order_number,customer_email,customer_name,items,subtotal_paise,payment_status,status,carrier,tracking_number,created_at',
    );
    const returnsTotal = (
      await request(app).get('/api/v1/admin/returns').set('Authorization', `Bearer ${admin.token}`)
    ).body as { total: number };
    const returnsCsv = await adminReq('get', '/reports/returns.csv?limit=10000');
    expect(returnsCsv.text.trim().split('\r\n').length - 1).toBe(returnsTotal.total);
  });

  it('escapes formula cells instead of emitting them raw', async () => {
    const created = await adminReq('post', '/products').send({
      sku: `EVIL-${Date.now()}`,
      name: '=HYPERLINK("http://evil.example")',
      pricePaise: 100,
      stock: 1,
    });
    expect(created.status).toBe(201);

    const csv = await adminReq('get', '/reports/inventory.csv?limit=10000');
    expect(csv.status).toBe(200);
    const evil = csv.text.split('\r\n').find((line: string) => line.includes('EVIL-'));
    expect(evil).toContain("'=HYPERLINK");

    for (const path of ['/reports/refunds.csv', '/reports/credit.csv', '/reports/movements.csv'] as const) {
      const res = await adminReq('get', path);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
    }
  });

  it('fences exports off from customers', async () => {
    const res = await request(app)
      .get('/api/v1/admin/reports/orders.csv')
      .set('Authorization', `Bearer ${customer.token}`);
    expect(res.status).toBe(403);
  });
});
