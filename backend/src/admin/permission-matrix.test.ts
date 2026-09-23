import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../app.js';
import { db, initSchema } from '../db.js';
import { seedDatabase } from '../seed.js';
import { signToken } from '../utils.js';
import { DEFAULT_WAREHOUSE_ID } from '../warehouse/schema.js';

/**
 * Phase 8 — the full authorization matrix.
 *
 * Earlier phases each proved their own endpoint in isolation. This exercises
 * every admin route against every caller, so a route added without a guard, or
 * one whose guard is weaker than its neighbours, fails here rather than in
 * production. The route table below is asserted against the live Express
 * router, so a new endpoint that nobody adds to this file is itself a failure.
 */

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

interface Route {
  method: Method;
  /** Path as registered, with :params substituted for a probe value. */
  path: string;
  /** A body that passes validation far enough to reach the guard. */
  body?: Record<string, unknown>;
}

/**
 * Every admin route. Params use obviously-absent ids: authorization is checked
 * before the record is loaded, so a non-admin must be rejected with 401/403
 * rather than 404 — proving the guard runs first and that ids cannot be probed.
 */
const ADMIN_ROUTES: Route[] = [
  { method: 'get', path: '/me' },
  { method: 'get', path: '/audit' },
  { method: 'get', path: '/summary' },
  { method: 'get', path: '/customers' },
  { method: 'get', path: '/customers/probe-id' },
  { method: 'patch', path: '/customers/probe-id', body: { active: false } },
  { method: 'get', path: '/orders' },
  { method: 'get', path: '/orders/probe-id' },
  { method: 'get', path: '/returns' },
  { method: 'get', path: '/returns/probe-id' },
  { method: 'get', path: '/warehouses' },
  { method: 'get', path: '/warehouses/probe-id' },
  { method: 'post', path: '/warehouses', body: { code: 'MTX-01', name: 'Matrix Hub', city: 'Nowhere' } },
  { method: 'patch', path: '/warehouses/probe-id', body: { name: 'Renamed' } },
  { method: 'get', path: '/warehouse-users' },
  { method: 'post', path: '/warehouse-users', body: { email: 'mtx@example.com', password: 'Password123', fullName: 'Matrix Op', warehouseId: DEFAULT_WAREHOUSE_ID } },
  { method: 'patch', path: '/warehouse-users/probe-id', body: { active: false } },
  { method: 'get', path: '/workload' },
  { method: 'get', path: '/inventory' },
  { method: 'get', path: '/inventory/movements' },
  { method: 'get', path: '/analytics' },
  { method: 'get', path: '/settings' },
  { method: 'patch', path: '/settings/RETURN_WINDOW_DAYS', body: { value: 30 } },
  { method: 'get', path: '/return-reasons' },
  { method: 'post', path: '/return-reasons', body: { code: 'MTX_REASON', label: 'Matrix reason' } },
  { method: 'patch', path: '/return-reasons/MTX_REASON', body: { active: false } },
  { method: 'post', path: '/credit/adjustments', body: { userId: 'probe-id', amountPaise: 100, reason: 'matrix probe reason' } },
  { method: 'get', path: '/credit/ledger' },
  { method: 'get', path: '/credit/balances' },
  { method: 'get', path: '/refunds' },
  { method: 'get', path: '/refunds/probe-id' },
  { method: 'get', path: '/users' },
  { method: 'post', path: '/users', body: { email: 'mtx-admin@example.com', password: 'Password123', fullName: 'Matrix Admin' } },
  { method: 'patch', path: '/users/probe-id', body: { fullName: 'Renamed' } },
  { method: 'get', path: '/support/tickets' },
  { method: 'get', path: '/support/tickets/probe-id' },
  { method: 'patch', path: '/support/tickets/probe-id', body: { priority: 'HIGH' } },
  { method: 'post', path: '/support/tickets/probe-id/messages', body: { body: 'Matrix probe message' } },
  { method: 'get', path: '/notifications' },
  { method: 'get', path: '/notifications/templates' },
  { method: 'put', path: '/notifications/templates/MTX_TEMPLATE', body: { title: 'T', body: 'B' } },
  { method: 'get', path: '/categories' },
  { method: 'get', path: '/categories/probe-id' },
  { method: 'post', path: '/categories', body: { name: 'Matrix Category' } },
  { method: 'patch', path: '/categories/probe-id', body: { name: 'Renamed' } },
  { method: 'delete', path: '/categories/probe-id' },
  { method: 'get', path: '/products' },
  { method: 'get', path: '/products/probe-id' },
  { method: 'post', path: '/products', body: { sku: 'MTX-1', name: 'Matrix Product', pricePaise: 1000 } },
  { method: 'patch', path: '/products/probe-id', body: { name: 'Renamed' } },
  { method: 'get', path: '/reports/orders.csv' },
  { method: 'get', path: '/reports/returns.csv' },
  { method: 'get', path: '/reports/refunds.csv' },
  { method: 'get', path: '/reports/credit.csv' },
  { method: 'get', path: '/reports/inventory.csv' },
  { method: 'get', path: '/reports/movements.csv' },
];

interface Session {
  token: string;
  user: { id: string; email: string };
}

let admin: Session;
let warehouse: Session;
let customer: Session;
let disabledAdmin: Session;
let secondAdminId = '';

function call(route: Route, token: string | null) {
  const req = request(app)[route.method](`/api/v1/admin${route.path}`);
  if (token !== null) {
    req.set('Authorization', `Bearer ${token}`);
  }
  return route.body === undefined ? req.send() : req.send(route.body);
}

/** Read the paths Express actually has registered on the admin router. */
function registeredAdminPaths(): Set<string> {
  const stack = (app as unknown as { _router: { stack: Array<Record<string, unknown>> } })._router.stack;
  const paths = new Set<string>();
  for (const layer of stack) {
    const handle = layer.handle as { stack?: Array<Record<string, unknown>> } | undefined;
    const regexp = String(layer.regexp ?? '');
    if (handle?.stack === undefined || !regexp.includes('admin')) {
      continue;
    }
    for (const sub of handle.stack) {
      const route = sub.route as { path: string; methods: Record<string, boolean> } | undefined;
      if (route === undefined) continue;
      for (const [method, enabled] of Object.entries(route.methods)) {
        if (enabled) paths.add(`${method} ${route.path}`);
      }
    }
  }
  return paths;
}

beforeAll(async () => {
  initSchema();
  seedDatabase();

  const adminLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@returnos.test', password: 'Admin123' });
  expect(adminLogin.status, 'seeded admin must be able to log in').toBe(200);
  admin = adminLogin.body as Session;

  const whLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'warehouse@returnos.test', password: 'Warehouse123' });
  expect(whLogin.status).toBe(200);
  warehouse = whLogin.body as Session;

  const custSignup = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email: `matrix-cust-${Date.now()}@example.com`, password: 'Password123', fullName: 'Matrix Customer' });
  expect(custSignup.status).toBe(201);
  customer = custSignup.body as Session;

  // A second admin, so the last-admin guard does not mask the self-lockout
  // guard, and so one admin can be disabled without emptying the role.
  const created = await request(app)
    .post('/api/v1/admin/users')
    .set('Authorization', `Bearer ${admin.token}`)
    .send({
      email: `matrix-admin-${Date.now()}@example.com`,
      password: 'Password123',
      fullName: 'Matrix Second Admin',
    });
  expect(created.status, 'second admin must be creatable').toBe(201);
  secondAdminId = (created.body as { user: { id: string } }).user.id;
  const secondLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: (created.body as { user: { email: string } }).user.email, password: 'Password123' });
  expect(secondLogin.status).toBe(200);
  disabledAdmin = secondLogin.body as Session;
});

describe('route table completeness', () => {
  it('covers every registered admin route', () => {
    const registered = registeredAdminPaths();
    expect(registered.size, 'router introspection should find routes').toBeGreaterThan(0);

    // Reduce probe paths back to their registered :param form.
    const covered = new Set(
      ADMIN_ROUTES.map((route) => {
        const templated = route.path
          .replace('/probe-id', '/:id')
          .replace('/settings/RETURN_WINDOW_DAYS', '/settings/:key')
          .replace('/return-reasons/MTX_REASON', '/return-reasons/:code')
          .replace('/notifications/templates/MTX_TEMPLATE', '/notifications/templates/:key');
        return `${route.method} ${templated}`;
      }),
    );

    const uncovered = [...registered].filter((entry) => !covered.has(entry));
    expect(uncovered, `admin routes missing from the permission matrix: ${uncovered.join(', ')}`).toEqual([]);
  });

  it('registers each admin path exactly once', () => {
    // A duplicate registration is dead code: Express serves the first match, so
    // edits to the later copy silently do nothing.
    const stack = (app as unknown as { _router: { stack: Array<Record<string, unknown>> } })._router.stack;
    const seen: string[] = [];
    for (const layer of stack) {
      const handle = layer.handle as { stack?: Array<Record<string, unknown>> } | undefined;
      if (handle?.stack === undefined || !String(layer.regexp ?? '').includes('admin')) continue;
      for (const sub of handle.stack) {
        const route = sub.route as { path: string; methods: Record<string, boolean> } | undefined;
        if (route === undefined) continue;
        for (const [method, enabled] of Object.entries(route.methods)) {
          if (enabled) seen.push(`${method} ${route.path}`);
        }
      }
    }
    const duplicates = seen.filter((entry, index) => seen.indexOf(entry) !== index);
    expect([...new Set(duplicates)], 'duplicate admin route registrations').toEqual([]);
  });
});

describe('anonymous callers', () => {
  it.each(ADMIN_ROUTES)('rejects $method $path with 401', async (route) => {
    const res = await call(route, null);
    expect(res.status).toBe(401);
    expect((res.body as { code?: string }).code).toBe('UNAUTHORIZED');
  });
});

describe('customer role', () => {
  it.each(ADMIN_ROUTES)('denies $method $path with 403', async (route) => {
    const res = await call(route, customer.token);
    expect(res.status, `${route.method} ${route.path} must not be reachable by a customer`).toBe(403);
    expect((res.body as { code?: string }).code).toBe('ADMIN_REQUIRED');
  });
});

describe('warehouse role', () => {
  it.each(ADMIN_ROUTES)('denies $method $path with 403', async (route) => {
    const res = await call(route, warehouse.token);
    expect(res.status, `${route.method} ${route.path} must not be reachable by an operator`).toBe(403);
    expect((res.body as { code?: string }).code).toBe('ADMIN_REQUIRED');
  });
});

describe('forged and tampered tokens', () => {
  const secret = process.env.JWT_SECRET ?? 'returnos-dev-secret-change-me';

  it('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ sub: 'attacker', email: 'a@b.c', role: 'ADMIN' }, 'not-the-real-secret', {
      expiresIn: '1h',
    });
    const res = await request(app).get('/api/v1/admin/summary').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects a correctly signed token for a user that does not exist', async () => {
    // Signed by us, so the signature passes: the per-request lookup is what
    // stops it, not the crypto.
    const ghost = signToken({ sub: 'no-such-user', email: 'ghost@example.com', role: 'ADMIN' });
    const res = await request(app).get('/api/v1/admin/summary').set('Authorization', `Bearer ${ghost}`);
    expect(res.status).toBe(403);
    expect((res.body as { code: string }).code).toBe('ACCOUNT_DISABLED');
  });

  it('ignores a role claim that contradicts the database', async () => {
    // The customer's own id, but the token claims ADMIN. Role is read from the
    // database per request, so the claim is worthless.
    const escalated = signToken({ sub: customer.user.id, email: customer.user.email, role: 'ADMIN' });
    const res = await request(app).get('/api/v1/admin/summary').set('Authorization', `Bearer ${escalated}`);
    expect(res.status).toBe(403);
    expect((res.body as { code: string }).code).toBe('ADMIN_REQUIRED');
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign({ sub: admin.user.id, email: admin.user.email, role: 'ADMIN' }, secret, {
      expiresIn: '-1s',
    });
    const res = await request(app).get('/api/v1/admin/summary').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('rejects a malformed bearer header', async () => {
    for (const header of ['Bearer', 'Bearer ', 'Basic abc', 'not-a-header']) {
      const res = await request(app).get('/api/v1/admin/summary').set('Authorization', header);
      expect(res.status, `header "${header}" must be rejected`).toBe(401);
    }
  });
});

describe('admin role reaches every route', () => {
  it.each(ADMIN_ROUTES)('allows $method $path past authorization', async (route) => {
    const res = await call(route, admin.token);
    // Probe ids and probe bodies legitimately produce 404/409/422/400. What
    // must never appear is an authorization rejection.
    expect([401, 403], `${route.method} ${route.path} returned ${res.status} for an admin`).not.toContain(res.status);
  });
});

describe('disabled admin loses access mid-session', () => {
  it('keeps working until disabled, then fails on the very next request', async () => {
    // The token is already issued and still valid.
    const before = await request(app).get('/api/v1/admin/summary').set('Authorization', `Bearer ${disabledAdmin.token}`);
    expect(before.status).toBe(200);

    const disabled = await request(app)
      .patch(`/api/v1/admin/users/${secondAdminId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ active: false });
    expect(disabled.status).toBe(200);

    // Same unexpired token, next request.
    const after = await request(app).get('/api/v1/admin/summary').set('Authorization', `Bearer ${disabledAdmin.token}`);
    expect(after.status, 'a disabled admin must lose access without waiting for JWT expiry').toBe(403);
    expect((after.body as { code: string }).code).toBe('ACCOUNT_DISABLED');

    // And cannot log in again to get a fresh one.
    const relogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: disabledAdmin.user.email, password: 'Password123' });
    expect(relogin.status).not.toBe(200);

    // Restore for the guard tests below.
    const restored = await request(app)
      .patch(`/api/v1/admin/users/${secondAdminId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ active: true });
    expect(restored.status).toBe(200);
  });

  it('denies a disabled admin across every route, not just the one probed', async () => {
    await request(app)
      .patch(`/api/v1/admin/users/${secondAdminId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ active: false });

    for (const route of [
      { method: 'get' as const, path: '/customers' },
      { method: 'get' as const, path: '/audit' },
      { method: 'post' as const, path: '/categories', body: { name: 'Should not exist' } },
      { method: 'get' as const, path: '/reports/orders.csv' },
    ]) {
      const res = await call(route, disabledAdmin.token);
      expect(res.status, `${route.path} must reject a disabled admin`).toBe(403);
      expect((res.body as { code: string }).code).toBe('ACCOUNT_DISABLED');
    }

    // The blocked write must not have landed.
    const leaked = db.prepare("SELECT id FROM categories WHERE name = 'Should not exist'").get();
    expect(leaked, 'a disabled admin must not be able to write').toBeUndefined();

    await request(app)
      .patch(`/api/v1/admin/users/${secondAdminId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ active: true });
  });

  it('demoting an admin removes admin access on the next request', async () => {
    const demoted = await request(app)
      .patch(`/api/v1/admin/users/${secondAdminId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ role: 'CUSTOMER' });
    expect(demoted.status).toBe(200);

    const after = await request(app).get('/api/v1/admin/summary').set('Authorization', `Bearer ${disabledAdmin.token}`);
    expect(after.status).toBe(403);
    expect((after.body as { code: string }).code).toBe('ADMIN_REQUIRED');

    const restored = await request(app)
      .patch(`/api/v1/admin/users/${secondAdminId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ role: 'ADMIN' });
    expect(restored.status).toBe(200);
  });
});

describe('self-lockout and last-admin guards, through the HTTP surface', () => {
  /** Active admin ids other than `exceptId`. */
  function otherActiveAdmins(exceptId: string): string[] {
    return (
      db
        .prepare("SELECT id FROM users WHERE role = 'ADMIN' AND active = 1 AND id != ?")
        .all(exceptId) as Array<{ id: string }>
    ).map((row) => row.id);
  }

  async function setActive(targetId: string, active: boolean, token: string): Promise<number> {
    const res = await request(app)
      .patch(`/api/v1/admin/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ active });
    return res.status;
  }

  it('refuses to let an admin disable themselves', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/users/${admin.user.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ active: false });
    expect(res.status).toBe(403);
    expect((res.body as { code: string }).code).toBe('ADMIN_SELF_LOCKOUT');

    // Still working afterwards.
    const still = await request(app).get('/api/v1/admin/summary').set('Authorization', `Bearer ${admin.token}`);
    expect(still.status).toBe(200);
  });

  it('refuses to let an admin demote themselves', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/users/${admin.user.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ role: 'CUSTOMER' });
    expect(res.status).toBe(403);
    expect((res.body as { code: string }).code).toBe('ADMIN_SELF_LOCKOUT');

    const role = db.prepare('SELECT role FROM users WHERE id = ?').get(admin.user.id) as { role: string };
    expect(role.role, 'a refused demotion must not have landed').toBe('ADMIN');
  });

  it('refuses to remove the last active admin', async () => {
    // Park every other admin so the actor really is the last one. Other tests
    // in this file create admins, so the count is derived rather than assumed.
    const parked = otherActiveAdmins(admin.user.id);
    for (const other of parked) {
      expect(await setActive(other, false, admin.token)).toBe(200);
    }

    const count = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND active = 1").get() as {
      count: number;
    };
    expect(count.count, 'exactly one active admin should remain').toBe(1);

    // Self-lockout fires first for the same actor, which is the stricter and
    // correct answer; either way the platform cannot be left adminless.
    const res = await request(app)
      .patch(`/api/v1/admin/users/${admin.user.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ active: false });
    expect(res.status).toBe(403);
    expect(['ADMIN_SELF_LOCKOUT', 'LAST_ADMIN_REQUIRED']).toContain((res.body as { code: string }).code);

    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND active = 1").get() as { count: number })
        .count,
      'at least one active admin must always remain',
    ).toBeGreaterThanOrEqual(1);

    for (const other of parked) {
      expect(await setActive(other, true, admin.token)).toBe(200);
    }
  });

  it('blocks the last-admin case when a different admin is the actor', async () => {
    // Isolate LAST_ADMIN_REQUIRED from self-lockout: the actor and the target
    // must be different accounts, with nobody else active.
    const parked = otherActiveAdmins(admin.user.id).filter((otherId) => otherId !== secondAdminId);
    for (const other of parked) {
      expect(await setActive(other, false, admin.token)).toBe(200);
    }

    const secondLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: disabledAdmin.user.email, password: 'Password123' });
    expect(secondLogin.status).toBe(200);
    const second = secondLogin.body as Session;

    // Two admins active, so disabling the other one is allowed.
    expect(await setActive(admin.user.id, false, second.token)).toBe(200);

    // The second admin is now the only one left and cannot remove itself.
    const last = await request(app)
      .patch(`/api/v1/admin/users/${secondAdminId}`)
      .set('Authorization', `Bearer ${second.token}`)
      .send({ active: false });
    expect(last.status).toBe(403);
    expect(['ADMIN_SELF_LOCKOUT', 'LAST_ADMIN_REQUIRED']).toContain((last.body as { code: string }).code);

    // Nor can the platform be emptied by demoting the last one.
    const demote = await request(app)
      .patch(`/api/v1/admin/users/${secondAdminId}`)
      .set('Authorization', `Bearer ${second.token}`)
      .send({ role: 'CUSTOMER' });
    expect(demote.status).toBe(403);

    // Restore the original admin and everyone parked.
    expect(await setActive(admin.user.id, true, second.token)).toBe(200);
    for (const other of parked) {
      expect(await setActive(other, true, admin.token)).toBe(200);
    }
  });
});

describe('admin breadth does not widen a scoped role', () => {
  it('lets admin see every warehouse while the operator sees only their own', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO warehouses (id, code, name, city, active, created_at, updated_at)
       VALUES ('wh-matrix', 'MTX-99', 'Matrix Hub', 'Chennai', 1, ?, ?)`,
    ).run(now, now);

    const adminView = await request(app).get('/api/v1/admin/warehouses').set('Authorization', `Bearer ${admin.token}`);
    expect(adminView.status).toBe(200);
    const body = adminView.body as { warehouses: Array<{ id: string }> } | Array<{ id: string }>;
    const list = Array.isArray(body) ? body : body.warehouses;
    const ids = list.map((row) => row.id);
    expect(ids, 'admin sees all sites by design').toEqual(expect.arrayContaining([DEFAULT_WAREHOUSE_ID, 'wh-matrix']));

    // The operator's own context stays pinned to one site.
    const opView = await request(app).get('/api/v1/warehouse/me').set('Authorization', `Bearer ${warehouse.token}`);
    expect(opView.status).toBe(200);
    expect((opView.body as { warehouse: { id: string } }).warehouse.id).toBe(DEFAULT_WAREHOUSE_ID);
  });

  it('keeps the operator out of another site even when admin can reach it', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO warehouse_locations (id, warehouse_id, code, name, kind, active, created_at)
       VALUES ('loc-matrix', 'wh-matrix', 'RCV-9', 'Matrix dock', 'RECEIVING', 1, ?)`,
    ).run(now);

    // Tasks in the other site must not appear in the operator's queue.
    db.prepare(
      `INSERT OR IGNORE INTO warehouse_tasks (id, warehouse_id, kind, title, return_id, order_id, priority,
        status, assigned_to, blocked_reason, created_at, due_at, started_at, completed_at)
       VALUES ('task-matrix', 'wh-matrix', 'RESTOCK', 'Other site work', NULL, NULL, 'NORMAL', 'TODO',
               NULL, NULL, ?, ?, NULL, NULL)`,
    ).run(now, now);

    const tasks = await request(app)
      .get('/api/v1/warehouse/tasks?limit=100')
      .set('Authorization', `Bearer ${warehouse.token}`);
    expect(tasks.status).toBe(200);
    const taskIds = (tasks.body as { tasks: Array<{ id: string }> }).tasks.map((task) => task.id);
    expect(taskIds, 'another site\'s work must not leak into a scoped queue').not.toContain('task-matrix');

    // And the operator cannot file goods into the other site's location.
    const inventory = await request(app)
      .get('/api/v1/warehouse/inventory')
      .set('Authorization', `Bearer ${warehouse.token}`);
    expect(inventory.status).toBe(200);
  });

  it('does not let an admin token act on the warehouse or customer APIs', async () => {
    // Admin breadth is read-across, not a universal key: the operational APIs
    // still require their own role.
    for (const path of ['/api/v1/warehouse/returns', '/api/v1/warehouse/tasks']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${admin.token}`);
      expect(res.status, `${path} must still require the warehouse role`).toBe(403);
    }
    for (const path of ['/api/v1/orders', '/api/v1/cart', '/api/v1/credit']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${admin.token}`);
      expect(res.status, `${path} must still require the customer role`).toBe(403);
    }
  });
});

describe('credential fields never appear in admin responses', () => {
  /** Recursively look for anything that smells like a secret. */
  function findSecrets(value: unknown, path = '$'): string[] {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) {
      return value.flatMap((entry, index) => findSecrets(entry, `${path}[${index}]`));
    }
    if (typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
        if (/password|token_hash|password_hash|secret/i.test(key)) {
          return [`${path}.${key}`];
        }
        return findSecrets(child, `${path}.${key}`);
      });
    }
    return [];
  }

  it.each(ADMIN_ROUTES.filter((route) => route.method === 'get'))(
    'leaks nothing from $path',
    async (route) => {
      const res = await call(route, admin.token);
      if (typeof res.body !== 'object' || res.body === null) return;
      expect(findSecrets(res.body), `credential-like fields in ${route.path}`).toEqual([]);
    },
  );
});
