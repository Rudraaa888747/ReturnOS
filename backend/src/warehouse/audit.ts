import { db } from '../db.js';
import { id, nowIso } from '../utils.js';
import type { AuditLogRow } from './types.js';

/**
 * Append-only audit trail.
 *
 * There is deliberately no update or delete helper here, and no route exposes
 * one: warehouse users can read their own history but cannot rewrite it.
 * Writes happen inside the caller's transaction, so an operation and its audit
 * row are recorded together or not at all.
 */

export interface AuditInput {
  actorId: string | null;
  actorRole: string;
  warehouseId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousState?: string | null;
  newState?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function recordAudit(input: AuditInput): void {
  db.prepare(
    `INSERT INTO audit_log (id, actor_id, actor_role, warehouse_id, action, entity_type, entity_id,
      previous_state, new_state, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id(),
    input.actorId,
    input.actorRole,
    input.warehouseId ?? null,
    input.action,
    input.entityType,
    input.entityId,
    input.previousState ?? null,
    input.newState ?? null,
    input.metadata === null || input.metadata === undefined ? null : JSON.stringify(input.metadata),
    nowIso(),
  );
}

export interface AuditQuery {
  warehouseId: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  limit: number;
  offset: number;
}

/** Audit history for a warehouse, newest first. */
export function listAudit(query: AuditQuery): { entries: AuditLogRow[]; total: number } {
  const filters = ['warehouse_id = ?'];
  const params: unknown[] = [query.warehouseId];
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
  const where = filters.join(' AND ');
  const total = (
    db.prepare(`SELECT COUNT(*) AS count FROM audit_log WHERE ${where}`).get(...params) as { count: number }
  ).count;
  const entries = db
    .prepare(`SELECT * FROM audit_log WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, query.limit, query.offset) as AuditLogRow[];
  return { entries, total };
}

/** Full trail for one entity, oldest first, for a return's history panel. */
export function auditForEntity(warehouseId: string, entityType: string, entityId: string): AuditLogRow[] {
  return db
    .prepare(
      `SELECT * FROM audit_log WHERE warehouse_id = ? AND entity_type = ? AND entity_id = ?
        ORDER BY created_at ASC, id ASC`,
    )
    .all(warehouseId, entityType, entityId) as AuditLogRow[];
}
