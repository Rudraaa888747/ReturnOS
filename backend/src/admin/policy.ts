import { db } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { auditAdminWrite } from './audit.js';

/**
 * Return-reason policy: add, edit, enable/disable, ordering.
 *
 * Reasons are referenced by history (return_items.reason_code has no
 * cascade), so codes are immutable and rows are never deleted — only
 * deactivated. The customer flow reads the same table through
 * listActiveReasons, so an admin change takes effect without a deploy.
 */

export interface ReasonRow {
  code: string;
  label: string;
  description: string | null;
  active: number;
  sort_order: number;
}

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

function loadReason(code: string): ReasonRow {
  const row = asSingle<ReasonRow>(db.prepare('SELECT * FROM return_reasons WHERE code = ?').get(code));
  if (row === undefined) {
    throw new HttpError(404, 'REASON_NOT_FOUND', 'Return reason not found');
  }
  return row;
}

/** Every reason, active or not, in display order. */
export function listReasonsAdmin(): { reasons: ReasonRow[] } {
  const reasons = asMany<ReasonRow>(
    db.prepare('SELECT * FROM return_reasons ORDER BY sort_order ASC, label ASC').all(),
  );
  return { reasons };
}

export interface ReasonCreateInput {
  code: string;
  label: string;
  description?: string | null;
  sortOrder?: number;
}

export const createReason = db.transaction(
  (actor: Actor, input: ReasonCreateInput): ReasonRow => {
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Reason code must start with a letter and contain only A-Z, 0-9 and underscore');
    }
    const label = input.label.trim();
    if (label.length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Reason label is required');
    }
    if (asSingle<{ code: string }>(db.prepare('SELECT code FROM return_reasons WHERE code = ?').get(code)) !== undefined) {
      throw new HttpError(409, 'REASON_EXISTS', `A return reason with code "${code}" already exists`);
    }
    const row: ReasonRow = {
      code,
      label,
      description: input.description?.trim() === '' || input.description == null ? null : input.description.trim(),
      active: 1,
      sort_order: input.sortOrder ?? 0,
    };
    db.prepare('INSERT INTO return_reasons (code, label, description, active, sort_order) VALUES (?, ?, ?, 1, ?)').run(
      row.code, row.label, row.description, row.sort_order,
    );
    auditAdminWrite({
      actorId: actor.id, action: 'REASON_CREATED', entityType: 'REASON', entityId: code,
      before: null, after: row, ip: actor.ip,
    });
    return row;
  },
);

export interface ReasonPatch {
  label?: string;
  description?: string | null;
  active?: boolean;
  sortOrder?: number;
}

export const updateReason = db.transaction(
  (actor: Actor, code: string, patch: ReasonPatch): ReasonRow => {
    const before = loadReason(code);
    let { label, description, active, sort_order: sortOrder } = before;
    if (patch.label !== undefined) {
      const trimmed = patch.label.trim();
      if (trimmed.length === 0) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Reason label is required');
      }
      label = trimmed;
    }
    if (patch.description !== undefined) {
      description = patch.description?.trim() === '' || patch.description == null ? null : patch.description.trim();
    }
    if (patch.active !== undefined) {
      active = patch.active ? 1 : 0;
    }
    if (patch.sortOrder !== undefined) {
      sortOrder = patch.sortOrder;
    }
    db.prepare('UPDATE return_reasons SET label = ?, description = ?, active = ?, sort_order = ? WHERE code = ?').run(
      label, description, active, sortOrder, code,
    );
    const after = loadReason(code);
    auditAdminWrite({
      actorId: actor.id, action: 'REASON_UPDATED', entityType: 'REASON', entityId: code,
      before, after, ip: actor.ip,
    });
    return after;
  },
);
