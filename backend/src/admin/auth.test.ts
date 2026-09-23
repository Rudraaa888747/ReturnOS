import { beforeAll, describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { app } from '../app.js';
import { db, initSchema } from '../db.js';
import { seedDatabase } from '../seed.js';
import { requireAdmin } from '../middleware/auth.js';
import { listAdminAudit, recordAdminAudit } from './audit.js';

/**
 * Phase 1 — admin authentication, authorization, and audit immutability.
 *
 * The properties that matter: only ADMIN reaches /admin/* (checked against
 * the database per request, so demotion is instant), signup can never mint
 * privilege, the permission argument is forward-compatible without opening
 * anything early, and the audit trail has no write path at all.
 */

interface Session {
  token: string;
  user: { id: string; role: string };
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
}

async function signupCustomer(): Promise<Session> {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email: uniqueEmail('adm'), password: 'Password123', fullName: 'Admin Probe' });
  expect(res.status).toBe(201);
  return res.body as Session;
}

async function loginWarehouse(): Promise<Session> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'warehouse@returnos.test', password: 'Warehouse123' });
  expect(res.status).toBe(200);
  return res.body as Session;
}

async function loginAdmin(): Promise<Session> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@returnos.test', password: 'Admin123' });
  expect(res.status).toBe(200);
  const body = res.body as Session;
  expect(body.user.role).toBe('ADMIN');
  return body;
}

let admin: Session;
let warehouse: Session;
let customer: Session;

beforeAll(async () => {
  initSchema();
  seedDatabase();
  admin = await loginAdmin();
  warehouse = await loginWarehouse();
  customer = await signupCustomer();
});

describe('admin authentication', () => {
  it('seeds exactly one admin account with the ADMIN role', () => {
    const rows = db.prepare("SELECT email FROM users WHERE role = 'ADMIN'").all() as Array<{ email: string }>;
    expect(rows).toEqual([{ email: 'admin@returnos.test' }]);
  });

  it('rejects anonymous and forged callers with 401', async () => {
    for (const path of ['/api/v1/admin/me', '/api/v1/admin/audit']) {
      const anon = await request(app).get(path);
      expect(anon.status).toBe(401);
      const forged = await request(app).get(path).set('Authorization', 'Bearer not-a-token');
      expect(forged.status).toBe(401);
    }
  });
});

describe('admin authorization', () => {
  it('serves context and audit to the admin', async () => {
    const me = await request(app).get('/api/v1/admin/me').set('Authorization', `Bearer ${admin.token}`);
    expect(me.status).toBe(200);
    expect((me.body as { user: { role: string } }).user.role).toBe('ADMIN');
    expect((me.body as { permissions: string[] }).permissions).toContain('STORE_CREDIT_MANAGE');

    const audit = await request(app).get('/api/v1/admin/audit').set('Authorization', `Bearer ${admin.token}`);
    expect(audit.status).toBe(200);
    expect(audit.body).toMatchObject({ entries: expect.any(Array), total: expect.any(Number) });
  });

  it('rejects customers and warehouse operators with 403, not 404', async () => {
    for (const session of [customer, warehouse]) {
      for (const path of ['/api/v1/admin/me', '/api/v1/admin/audit']) {
        const res = await request(app).get(path).set('Authorization', `Bearer ${session.token}`);
        expect(res.status).toBe(403);
        expect((res.body as { code: string }).code).toBe('ADMIN_REQUIRED');
      }
    }
  });

  it('demotes instantly: a mid-session role change takes effect on the next request', async () => {
    const before = await request(app).get('/api/v1/admin/me').set('Authorization', `Bearer ${admin.token}`);
    expect(before.status).toBe(200);

    db.prepare("UPDATE users SET role = 'CUSTOMER' WHERE id = ?").run(admin.user.id);
    try {
      const after = await request(app).get('/api/v1/admin/me').set('Authorization', `Bearer ${admin.token}`);
      expect(after.status).toBe(403);
    } finally {
      db.prepare("UPDATE users SET role = 'ADMIN' WHERE id = ?").run(admin.user.id);
    }

    const restored = await request(app).get('/api/v1/admin/me').set('Authorization', `Bearer ${admin.token}`);
    expect(restored.status).toBe(200);
  });

  it('never mints ADMIN through public signup', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: uniqueEmail('escalate'), password: 'Password123', fullName: 'Escalator', role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect((res.body as { user: { role: string } }).user.role).toBe('CUSTOMER');
  });
});

describe('permission-argument shape', () => {
  function runMiddleware(user: { id: string } | undefined, permission?: string): unknown {
    let captured: unknown;
    const next: NextFunction = (err?: unknown) => {
      captured = err;
    };
    // Permission strings are validated at request time; the cast models a
    // future call site passing any registry string.
    requireAdmin(permission as never)({ user } as Request, {} as Response, next);
    return captured;
  }

  it('passes an admin for a registered permission', () => {
    expect(runMiddleware({ id: admin.user.id }, 'STORE_CREDIT_MANAGE')).toBeUndefined();
  });

  it('fails closed and loud on an unregistered permission string', () => {
    // hasPermission throws synchronously; Express converts that into the 500
    // the operator sees, so the endpoint can never silently open.
    let thrown: unknown;
    try {
      runMiddleware({ id: admin.user.id }, 'NOPE_NOT_REAL');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ status: 500, code: 'PERMISSION_NOT_REGISTERED' });
  });

  it('still rejects a non-admin before the permission is even considered', () => {
    const err = runMiddleware({ id: customer.user.id }, 'AUDIT_VIEW') as { status?: number };
    expect(err?.status).toBe(403);
  });

  it('still requires authentication', () => {
    const err = runMiddleware(undefined, 'AUDIT_VIEW') as { status?: number };
    expect(err?.status).toBe(401);
  });
});

describe('admin audit trail', () => {
  it('appends entries the list endpoint serves back with filters', () => {
    recordAdminAudit({
      actorId: admin.user.id,
      actorRole: 'ADMIN',
      action: 'ADMIN_TEST_WRITE',
      entityType: 'RETURN',
      entityId: 'r-probe-1',
      previousState: 'BEFORE',
      newState: 'AFTER',
      metadata: { reason: 'probe' },
      ip: '127.0.0.1',
    });

    expect(listAdminAudit({ limit: 25, offset: 0 }).total).toBeGreaterThanOrEqual(1);
    const filtered = listAdminAudit({ entityId: 'r-probe-1', limit: 25, offset: 0 });
    expect(filtered.total).toBe(1);
    expect(filtered.entries[0]).toMatchObject({
      action: 'ADMIN_TEST_WRITE',
      actor_role: 'ADMIN',
      previous_state: 'BEFORE',
      new_state: 'AFTER',
      ip: '127.0.0.1',
    });
    expect(JSON.parse(filtered.entries[0].metadata ?? '{}')).toEqual({ reason: 'probe' });
  });

  it('serves the entry over HTTP with the audit permission gate', async () => {
    const res = await request(app)
      .get('/api/v1/admin/audit?entityId=r-probe-1')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect((res.body as { total: number }).total).toBe(1);
  });

  it('exposes no write path: POST, PATCH and DELETE all 404', async () => {
    const token = admin.token;
    expect((await request(app).post('/api/v1/admin/audit').set('Authorization', `Bearer ${token}`).send({})).status).toBe(
      404,
    );
    expect((await request(app).patch('/api/v1/admin/audit/x').set('Authorization', `Bearer ${token}`).send({})).status).toBe(
      404,
    );
    expect((await request(app).delete('/api/v1/admin/audit/x').set('Authorization', `Bearer ${token}`)).status).toBe(404);
  });

  it('has no update or delete helper to call', async () => {
    const audit = await import('./audit.js');
    expect('updateAdminAudit' in audit).toBe(false);
    expect('deleteAdminAudit' in audit).toBe(false);
  });
});
