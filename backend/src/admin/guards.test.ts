import { beforeAll, describe, expect, it } from 'vitest';
import { db, initSchema } from '../db.js';
import { guardAccountChange } from './users.js';

/**
 * The two admin-management guards, built and tested before any endpoint
 * that could violate them: no self-lockout, never zero admins. Pure
 * function tests — no HTTP, no fixtures beyond three user rows.
 */

function insertUser(id: string, role: string, active: number): void {
  db.prepare(
    'INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role, warehouse_id, active, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)',
  ).run(id, `${id}@example.com`, 'hash', id, role, active, new Date().toISOString());
}

function codeOf(fn: () => void): string | null {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code ?? 'THREW';
  }
  return null;
}

beforeAll(() => {
  initSchema();
  insertUser('g-admin-1', 'ADMIN', 1);
  insertUser('g-admin-2', 'ADMIN', 1);
  insertUser('g-customer', 'CUSTOMER', 1);
});

describe('self-lockout guard', () => {
  it('refuses self-disable with a named error and touches nothing', () => {
    expect(codeOf(() => guardAccountChange('g-admin-1', 'g-admin-1', { active: false }))).toBe('ADMIN_SELF_LOCKOUT');
    expect(
      (db.prepare('SELECT active FROM users WHERE id = ?').get('g-admin-1') as { active: number }).active,
    ).toBe(1);
  });

  it('refuses self-demotion', () => {
    expect(codeOf(() => guardAccountChange('g-admin-1', 'g-admin-1', { role: 'CUSTOMER' }))).toBe('ADMIN_SELF_LOCKOUT');
  });
});

describe('last-admin guard', () => {
  it('refuses to disable the only remaining active admin', () => {
    db.prepare("UPDATE users SET role = 'CUSTOMER' WHERE id = 'g-admin-2'").run();
    try {
      expect(codeOf(() => guardAccountChange('g-customer', 'g-admin-1', { active: false }))).toBe('LAST_ADMIN_REQUIRED');
    } finally {
      db.prepare("UPDATE users SET role = 'ADMIN' WHERE id = 'g-admin-2'").run();
    }
  });

  it('refuses to demote the only remaining active admin', () => {
    db.prepare("UPDATE users SET role = 'CUSTOMER' WHERE id = 'g-admin-2'").run();
    try {
      expect(codeOf(() => guardAccountChange('g-customer', 'g-admin-1', { role: 'CUSTOMER' }))).toBe('LAST_ADMIN_REQUIRED');
    } finally {
      db.prepare("UPDATE users SET role = 'ADMIN' WHERE id = 'g-admin-2'").run();
    }
  });

  it('allows the same changes while a second active admin exists', () => {
    expect(codeOf(() => guardAccountChange('g-admin-1', 'g-admin-2', { active: false }))).toBeNull();
    expect(codeOf(() => guardAccountChange('g-admin-1', 'g-admin-2', { role: 'CUSTOMER' }))).toBeNull();
  });
});
