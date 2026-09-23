import { db } from '../db.js';

/** Admin-owned schema. Runs inside the same initSchema() pass. */
export function initAdminSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id TEXT PRIMARY KEY,
      actor_id TEXT NULL REFERENCES users(id),
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      previous_state TEXT NULL,
      new_state TEXT NULL,
      metadata TEXT NULL,
      ip TEXT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_by TEXT NULL REFERENCES users(id),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_templates (
      key TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_admin_audit_entity ON admin_audit_log(entity_type, entity_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_log(actor_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action, created_at);
  `);
  migrateSupportAuthorRole();
}

/**
 * Widen support_messages.author_role to include ADMIN without dropping the
 * constraint. SQLite cannot ALTER a CHECK, so the table is rebuilt — rows
 * preserved, indexes recreated. Runs only when the stored definition still
 * carries the old two-role check.
 */
export function migrateSupportAuthorRole(): void {
  const sql = (
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'support_messages'").get() as
      | { sql: string }
      | undefined
  )?.sql;
  if (sql === undefined || sql.includes("'ADMIN'")) {
    return;
  }
  const run = db.transaction(() => {
    db.exec(`
      CREATE TABLE support_messages_new (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        author_role TEXT NOT NULL CHECK (author_role IN ('CUSTOMER', 'ADMIN', 'SYSTEM')),
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO support_messages_new (id, ticket_id, author_role, body, created_at)
        SELECT id, ticket_id, author_role, body, created_at FROM support_messages;
      DROP TABLE support_messages;
      ALTER TABLE support_messages_new RENAME TO support_messages;
      CREATE INDEX IF NOT EXISTS idx_messages_ticket ON support_messages(ticket_id);
    `);
  });
  run();
}
