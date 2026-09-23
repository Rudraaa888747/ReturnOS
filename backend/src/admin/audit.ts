import { db } from '../db.js';
import { id, nowIso } from '../utils.js';

/**
 * Admin audit trail.
 *
 * Dedicated table (not the warehouse audit_log with a NULL-warehouse
 * special case): admin actions span every domain, and a separate
 * append-only table keeps both trails queryable on their own terms.
 * There is deliberately no update or delete helper, and no route may
 * expose one.
 */

export interface AdminAuditInput {
  actorId: string | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  previousState?: string | null;
  newState?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Request IP where the caller has one. */
  ip?: string | null;
}

export interface AdminAuditRow {
  id: string;
  actor_id: string | null;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  previous_state: string | null;
  new_state: string | null;
  metadata: string | null;
  ip: string | null;
  created_at: string;
}

export interface AdminAuditQuery {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  limit: number;
  offset: number;
}

export function recordAdminAudit(input: AdminAuditInput): AdminAuditRow {
  const row: AdminAuditRow = {
    id: id(),
    actor_id: input.actorId,
    actor_role: input.actorRole,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    previous_state: input.previousState ?? null,
    new_state: input.newState ?? null,
    metadata: input.metadata === null || input.metadata === undefined ? null : JSON.stringify(input.metadata),
    ip: input.ip ?? null,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO admin_audit_log (id, actor_id, actor_role, action, entity_type, entity_id,
      previous_state, new_state, metadata, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id, row.actor_id, row.actor_role, row.action, row.entity_type, row.entity_id,
    row.previous_state, row.new_state, row.metadata, row.ip, row.created_at,
  );
  return row;
}

/** Admin audit history, newest first. Read-only by design. */
export function listAdminAudit(query: AdminAuditQuery): { entries: AdminAuditRow[]; total: number } {
  const filters: string[] = [];
  const params: unknown[] = [];
  if (query.action !== undefined) {
    filters.push('action = ?');
    params.push(query.action);
  }
  if (query.entityType !== undefined) {
    filters.push('entity_type = ?');
    params.push(query.entityType);
  }
  if (query.entityId !== undefined) {
    filters.push('entity_id = ?');
    params.push(query.entityId);
  }
  if (query.actorId !== undefined) {
    filters.push('actor_id = ?');
    params.push(query.actorId);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const total = (
    db.prepare(`SELECT COUNT(*) AS count FROM admin_audit_log ${where}`).get(...params) as { count: number }
  ).count;
  const entries = db
    .prepare(`SELECT * FROM admin_audit_log ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, query.limit, query.offset) as AdminAuditRow[];
  return { entries, total };
}

/** Full trail for one entity, oldest first, for admin history views. */
export function auditForAdminEntity(entityType: string, entityId: string): AdminAuditRow[] {
  return db
    .prepare(
      `SELECT * FROM admin_audit_log WHERE entity_type = ? AND entity_id = ?
        ORDER BY created_at ASC, id ASC`,
    )
    .all(entityType, entityId) as AdminAuditRow[];
}

/**
 * THE write pattern for every future admin mutation (products today, credit
 * and settings tomorrow): snapshot before/after into the admin trail.
 * MUST be called inside the caller's transaction so the business write and
 * its audit row land together or not at all.
 */
export function auditAdminWrite(input: {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}): AdminAuditRow {
  return recordAdminAudit({
    actorId: input.actorId,
    actorRole: 'ADMIN',
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    previousState: input.before === undefined ? null : JSON.stringify(input.before),
    newState: input.after === undefined ? null : JSON.stringify(input.after),
    metadata: input.metadata ?? null,
    ip: input.ip ?? null,
  });
}
