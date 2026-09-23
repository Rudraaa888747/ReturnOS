import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db, initSchema } from '../db.js';
import { seedDatabase } from '../seed.js';
import { creditBalance } from '../store.js';

/**
 * Phase 4 — admin store-credit adjustments and refund visibility.
 *
 * The contract under test: adjustments require admin auth plus a real
 * justification, move money only through the shared ledger function with
 * an ADMIN_ADJUSTMENT reference (so the unique dedupe protects them like
 * payouts), dual-stamp the admin trail with before/after balances, refuse
 * overdrafts, and replay idempotently. Refunds stay read-only: every
 * legitimate transition already has an owner in the resolve engine.
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

beforeAll(async () => {
  initSchema();
  seedDatabase();
  admin = await loginAdmin();
  customer = await signupCustomer('fin');
});

function adminReq(method: 'get' | 'post', path: string) {
  return request(app)[method](`/api/v1/admin${path}`).set('Authorization', `Bearer ${admin.token}`);
}

describe('store credit adjustments', () => {
  const keyCredit = randomUUID();
  const keyDebit = randomUUID();
  let userId = '';

  it('credits through the shared ledger with a dual audit stamp', async () => {
    userId = customer.user.id;
    expect(creditBalance(userId)).toBe(0);

    const res = await adminReq('post', '/credit/adjustments').send({
      userId,
      direction: 'CREDIT',
      amountPaise: 100000,
      reason: 'Goodwill for a delayed replacement shipment',
      key: keyCredit,
    });
    expect(res.status).toBe(201);
    const body = res.body as { replayed: boolean; balancePaise: number; entry: { id: string; reference_type: string; reference_id: string } };
    expect(body.replayed).toBe(false);
    expect(body.balancePaise).toBe(100000);
    expect(body.entry.reference_type).toBe('ADMIN_ADJUSTMENT');
    expect(body.entry.reference_id).toBe(keyCredit);
    expect(creditBalance(userId)).toBe(100000);

    const audits = db
      .prepare("SELECT previous_state, new_state FROM admin_audit_log WHERE action = 'CREDIT_ADJUSTED' AND entity_id = ?")
      .all(body.entry.id) as Array<{ previous_state: string; new_state: string }>;
    expect(audits).toHaveLength(1);
    expect(JSON.parse(audits[0].previous_state)).toEqual({ balancePaise: 0 });
    expect(JSON.parse(audits[0].new_state)).toEqual({ balancePaise: 100000 });
  });

  it('debits with the same discipline', async () => {
    const res = await adminReq('post', '/credit/adjustments').send({
      userId,
      direction: 'DEBIT',
      amountPaise: 30000,
      reason: 'Correction of the earlier goodwill double entry',
      key: keyDebit,
    });
    expect(res.status).toBe(201);
    expect((res.body as { balancePaise: number }).balancePaise).toBe(70000);
    expect(creditBalance(userId)).toBe(70000);
  });

  it('replays the same key without a second financial effect', async () => {
    const auditBefore = (
      db.prepare("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'CREDIT_ADJUSTED'").get() as { count: number }
    ).count;

    const res = await adminReq('post', '/credit/adjustments').send({
      userId,
      direction: 'CREDIT',
      amountPaise: 100000,
      reason: 'Accidental resubmission of the same adjustment',
      key: keyCredit,
    });
    expect(res.status).toBe(200);
    expect((res.body as { replayed: boolean }).replayed).toBe(true);
    expect(creditBalance(userId)).toBe(70000);

    const rows = db
      .prepare("SELECT COUNT(*) AS count FROM store_credit_ledger WHERE reference_type = 'ADMIN_ADJUSTMENT' AND reference_id = ?")
      .get(keyCredit) as { count: number };
    expect(rows.count).toBe(1);
    const auditAfter = (
      db.prepare("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'CREDIT_ADJUSTED'").get() as { count: number }
    ).count;
    expect(auditAfter).toBe(auditBefore);
  });

  it('refuses overdrafts, missing reasons and bad amounts', async () => {
    const overdraft = await adminReq('post', '/credit/adjustments').send({
      userId,
      direction: 'DEBIT',
      amountPaise: 100000,
      reason: 'Trying to take more than the balance holds',
      key: randomUUID(),
    });
    expect(overdraft.status).toBe(409);
    expect((overdraft.body as { code: string }).code).toBe('INSUFFICIENT_CREDIT');
    expect(creditBalance(userId)).toBe(70000);

    const short = await adminReq('post', '/credit/adjustments').send({
      userId,
      direction: 'CREDIT',
      amountPaise: 100,
      reason: 'x',
      key: randomUUID(),
    });
    expect(short.status).toBe(400);

    const zero = await adminReq('post', '/credit/adjustments').send({
      userId,
      direction: 'CREDIT',
      amountPaise: 0,
      reason: 'Zero adjustment attempt recorded here',
      key: randomUUID(),
    });
    expect(zero.status).toBe(400);

    const ghost = await adminReq('post', '/credit/adjustments').send({
      userId: 'u-nope',
      direction: 'CREDIT',
      amountPaise: 100,
      reason: 'Nobody to credit here either',
      key: randomUUID(),
    });
    expect(ghost.status).toBe(404);
  });

  it('lists ledger and balances without credential fields', async () => {
    const ledger = await adminReq('get', '/credit/ledger?referenceType=ADMIN_ADJUSTMENT');
    expect(ledger.status).toBe(200);
    const entries = (ledger.body as { entries: Array<{ user_email: string }> }).entries;
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(ledger.body).includes('password_hash')).toBe(false);

    const balances = await adminReq('get', '/credit/balances');
    expect(balances.status).toBe(200);
    const row = ((balances.body as { balances: Array<{ user_id: string; balance_paise: number }> }).balances).find(
      (entry) => entry.user_id === userId,
    );
    expect(row?.balance_paise).toBe(70000);
  });

  it('fences adjustments and ledger reads off from customers', async () => {
    const post = await request(app)
      .post('/api/v1/admin/credit/adjustments')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ userId, direction: 'CREDIT', amountPaise: 1, reason: 'self-enrichment attempt', key: randomUUID() });
    expect(post.status).toBe(403);
    const get = await request(app)
      .get('/api/v1/admin/credit/ledger')
      .set('Authorization', `Bearer ${customer.token}`);
    expect(get.status).toBe(403);
  });
});

describe('refunds stay read-only and visible', () => {
  it('lists the seeded pending refund with its linkage', async () => {
    const res = await adminReq('get', '/refunds?status=PENDING');
    expect(res.status).toBe(200);
    const rows = (res.body as { refunds: Array<{ return_number: string; kind: string }> }).refunds;
    const seeded = rows.find((row) => row.return_number === 'RET-2026-0841');
    expect(seeded?.kind).toBe('REFUND');
    expect(JSON.stringify(res.body).includes('password_hash')).toBe(false);
  });

  it('shows one refund with full context', async () => {
    const id = (
      db.prepare("SELECT id FROM refunds WHERE return_id = 'r-2026-0841'").get() as { id: string }
    ).id;
    const res = await adminReq('get', `/refunds/${id}`);
    expect(res.status).toBe(200);
    expect((res.body as { refund: { customer_email: string; status: string } }).refund.customer_email).toBe(
      'rudrachokshi441@gmail.com',
    );
    expect((res.body as { refund: { status: string } }).refund.status).toBe('PENDING');
  });

  it('404s unknown refunds and 403s customers', async () => {
    expect((await adminReq('get', '/refunds/nope')).status).toBe(404);
    const res = await request(app)
      .get('/api/v1/admin/refunds')
      .set('Authorization', `Bearer ${customer.token}`);
    expect(res.status).toBe(403);
  });
});
