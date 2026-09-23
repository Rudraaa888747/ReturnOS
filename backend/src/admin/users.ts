import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { auditAdminWrite } from './audit.js';

/**
 * Admin user management guards and lifecycle.
 *
 * Built guards-first on purpose: the two rules below were implemented and
 * tested before any endpoint existed, because a self-lockout or a
 * zero-admin database cannot be undone from inside the system.
 *
 * Rule 1 — no self-lockout: an admin can never disable or demote their own
 * account. The call fails named, the row is untouched.
 * Rule 2 — never zero admins: disabling or demoting the last remaining
 * active ADMIN fails named. Recovery would otherwise need raw DB access.
 */

export interface Actor {
  id: string;
  ip?: string | null;
}

function asSingle<T>(value: unknown): T | undefined {
  return value as T | undefined;
}

function asMany<T>(value: unknown): T[] {
  return value as T[];
}

export interface AdminUserRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  active: number;
  created_at: string;
}

function loadAnyUser(userId: string): { id: string; role: string; active: number } {
  const row = asSingle<{ id: string; role: string; active: number }>(
    db.prepare('SELECT id, role, active FROM users WHERE id = ?').get(userId),
  );
  if (row === undefined) {
    throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
  }
  return row;
}

function activeAdminCount(excludeId?: string): number {
  if (excludeId === undefined) {
    return (db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND active = 1").get() as {
      count: number;
    }).count;
  }
  return (
    db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND active = 1 AND id != ?").get(excludeId) as {
      count: number;
    }
  ).count;
}

/**
 * Guard a status/role change on an admin-managed account. Throws named
 * errors; returns nothing. Pure check — no writes, so it unit-tests
 * without HTTP or fixtures beyond rows.
 */
export function guardAccountChange(
  actorId: string,
  targetId: string,
  change: { active?: boolean; role?: string },
): void {
  const target = loadAnyUser(targetId);
  const demotes = change.role !== undefined && change.role !== 'ADMIN' && target.role === 'ADMIN';
  const disables = change.active === false && target.active === 1;

  if (target.role === 'ADMIN' && (disables || demotes)) {
    if (targetId === actorId) {
      throw new HttpError(403, 'ADMIN_SELF_LOCKOUT', 'An admin cannot disable or demote their own account');
    }
    if (activeAdminCount(targetId) === 0) {
      throw new HttpError(
        403,
        'LAST_ADMIN_REQUIRED',
        'This is the last remaining active admin account and cannot be disabled or demoted',
      );
    }
  }
}

export interface AdminUserListQuery {
  search?: string;
  role?: string;
  active?: boolean;
  limit: number;
  offset: number;
}

/** Admin and (for review) other accounts. Explicit safe columns only. */
export function listAdminUsers(query: AdminUserListQuery): {
  users: AdminUserRow[];
  total: number;
} {
  const filters: string[] = [];
  const params: unknown[] = [];
  if (query.role !== undefined && query.role !== '') {
    filters.push('u.role = ?');
    params.push(query.role);
  } else {
    filters.push("u.role = 'ADMIN'");
  }
  if (query.active !== undefined) {
    filters.push('u.active = ?');
    params.push(query.active ? 1 : 0);
  }
  if (query.search !== undefined && query.search.trim() !== '') {
    const term = `%${query.search.trim().toLowerCase()}%`;
    filters.push('(LOWER(u.email) LIKE ? OR LOWER(u.full_name) LIKE ?)');
    params.push(term, term);
  }
  const where = `WHERE ${filters.join(' AND ')}`;
  const total = asSingle<{ count: number }>(
    db.prepare(`SELECT COUNT(*) AS count FROM users u ${where}`).get(...params),
  )?.count ?? 0;
  const users = asMany<AdminUserRow>(
    db.prepare(
      `SELECT u.id, u.email, u.full_name, u.role, u.active, u.created_at
         FROM users u ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    ).all(...params, query.limit, query.offset),
  );
  return { users, total };
}

export interface AdminCreateInput {
  email: string;
  password: string;
  fullName: string;
}

export const createAdminUser = db.transaction(
  (actor: Actor, input: AdminCreateInput): AdminUserRow => {
    const email = input.email.toLowerCase().trim();
    if (input.password.length < 8) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Admin password must be at least 8 characters');
    }
    if (input.fullName.trim().length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Admin name is required');
    }
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email) !== undefined) {
      throw new HttpError(409, 'EMAIL_EXISTS', 'An account with this email already exists');
    }
    const now = new Date().toISOString();
    const row: AdminUserRow = {
      id: `u-admin-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      email,
      full_name: input.fullName.trim(),
      role: 'ADMIN',
      active: 1,
      created_at: now,
    };
    db.prepare(
      'INSERT INTO users (id, email, password_hash, full_name, role, warehouse_id, active, created_at) VALUES (?, ?, ?, ?, ?, NULL, 1, ?)',
    ).run(row.id, row.email, bcrypt.hashSync(input.password, 10), row.full_name, row.role, row.created_at);
    auditAdminWrite({
      actorId: actor.id, action: 'ADMIN_CREATED', entityType: 'USER', entityId: row.id,
      before: null, after: row, ip: actor.ip,
    });
    return row;
  },
);

export interface AdminUserPatch {
  fullName?: string;
  active?: boolean;
  role?: string;
}

export const updateAdminUser = db.transaction(
  (actor: Actor, userId: string, patch: AdminUserPatch): AdminUserRow => {
    const target = asSingle<AdminUserRow>(
      db.prepare('SELECT id, email, full_name, role, active, created_at FROM users WHERE id = ?').get(userId),
    );
    if (target === undefined) {
      throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
    }
    // Admin and customer accounts live here. Operators belong to the
    // warehouse-users endpoints; letting this path touch them would split
    // their lifecycle across two owners.
    if (target.role !== 'ADMIN' && target.role !== 'CUSTOMER') {
      throw new HttpError(422, 'ROLE_NOT_MANAGED', 'Only admin and customer accounts are managed here');
    }
    if (patch.role !== undefined && patch.role !== 'ADMIN' && patch.role !== 'CUSTOMER') {
      throw new HttpError(422, 'ROLE_NOT_MANAGED', 'Admin accounts may only move between ADMIN and CUSTOMER');
    }
    // Guards first: both rules evaluated before any write.
    if (patch.active === false || (patch.role !== undefined && patch.role !== target.role)) {
      guardAccountChange(actor.id, userId, { active: patch.active, role: patch.role });
    }
    const before = { ...target };
    const fullName = patch.fullName !== undefined ? patch.fullName.trim() : target.full_name;
    if (fullName.length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Admin name is required');
    }
    const active = patch.active === undefined ? target.active : patch.active ? 1 : 0;
    const role = patch.role ?? target.role;
    db.prepare('UPDATE users SET full_name = ?, active = ?, role = ? WHERE id = ?').run(fullName, active, role, userId);
    const after = asSingle<AdminUserRow>(
      db.prepare('SELECT id, email, full_name, role, active, created_at FROM users WHERE id = ?').get(userId),
    );
    if (after === undefined) {
      throw new HttpError(500, 'USER_ERROR', 'User could not be loaded after update');
    }
    auditAdminWrite({
      actorId: actor.id, action: 'ADMIN_UPDATED', entityType: 'USER', entityId: userId,
      before, after, ip: actor.ip,
    });
    return after;
  },
);

/** Customer enable/disable. In-flight orders and returns keep resolving:
 *  warehouse operations never consult customer active status, only the
 *  customer-facing gates do — so a ban stops future transacting without
 *  stranding existing work. No transaction blockers by design. */
export const setCustomerActive = db.transaction(
  (actor: Actor, userId: string, active: boolean): AdminUserRow => {
    const target = asSingle<AdminUserRow>(
      db.prepare('SELECT id, email, full_name, role, active, created_at FROM users WHERE id = ?').get(userId),
    );
    if (target === undefined || target.role !== 'CUSTOMER') {
      throw new HttpError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
    const before = { ...target };
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, userId);
    const after = asSingle<AdminUserRow>(
      db.prepare('SELECT id, email, full_name, role, active, created_at FROM users WHERE id = ?').get(userId),
    );
    if (after === undefined) {
      throw new HttpError(500, 'USER_ERROR', 'Customer could not be loaded after update');
    }
    auditAdminWrite({
      actorId: actor.id, action: active ? 'CUSTOMER_ENABLED' : 'CUSTOMER_DISABLED', entityType: 'USER', entityId: userId,
      before, after, ip: actor.ip,
    });
    return after;
  },
);
