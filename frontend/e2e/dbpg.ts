import { Pool } from 'pg';

// PostgreSQL access for E2E specs targeting the Java backend. Replaces the
// old better-sqlite3 handle: same placeholder style (`?` auto-rewritten to
// $n), `dbGet` returns the first row (or undefined), `dbAll` returns rows,
// `dbRun` runs a write. Only clock nudges and id lookups go through here —
// every status change is still written by backend code.
const E2E_URL = process.env.E2E_PG_URL ?? 'postgresql://test:test@localhost:5433/returnos_e2e';

const pool = new Pool({ connectionString: E2E_URL });

function pq(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${(i += 1)}`);
}

export async function dbGet<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  const r = await pool.query(pq(sql), params);
  return r.rows[0] as T | undefined;
}

export async function dbAll<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const r = await pool.query(pq(sql), params);
  return r.rows as T[];
}

export async function dbRun(sql: string, ...params: unknown[]): Promise<void> {
  await pool.query(pq(sql), params);
}

/** Wipe the E2E schema; the Java backend recreates it via Flyway on boot. */
export async function resetJavaDb(): Promise<void> {
  const admin = new Pool({ connectionString: E2E_URL.replace(/\/[^/]*$/, '/postgres') });
  try {
    await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } finally {
    await admin.end();
  }
}
