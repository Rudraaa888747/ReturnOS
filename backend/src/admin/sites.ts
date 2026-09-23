import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { id, nowIso } from '../utils.js';
import { auditAdminWrite } from './audit.js';

/**
 * Warehouse and operator lifecycle, admin-side.
 *
 * Same disciplines as the catalogue writes: one transaction per mutation
 * with a before/after admin audit row, and explicit 409s (never silent)
 * when the change would strand live work — a site with open tasks or
 * unprocessed parcels, or an operator holding either, cannot simply be
 * switched off. Audit snapshots never carry password hashes.
 */

export interface Actor {
  id: string;
  ip?: string | null;
}

export interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  city: string;
  active: number;
  created_at: string;
  updated_at: string;
}

function asSingle<T>(value: unknown): T | undefined {
  return value as T | undefined;
}

function asMany<T>(value: unknown): T[] {
  return value as T[];
}

function loadWarehouse(warehouseId: string): WarehouseRow {
  const row = asSingle<WarehouseRow>(db.prepare('SELECT * FROM warehouses WHERE id = ?').get(warehouseId));
  if (row === undefined) {
    throw new HttpError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found');
  }
  return row;
}

/** Live work pinning a site: open tasks plus received-but-unprocessed parcels. */
export function siteBlockers(warehouseId: string): {
  openTasks: number;
  pendingReturns: number;
  taskTitles: string[];
  returnNumbers: string[];
  operatorsAssigned: number;
} {
  const tasks = asMany<{ title: string }>(
    db.prepare(
      `SELECT title FROM warehouse_tasks WHERE warehouse_id = ? AND status IN ('TODO', 'IN_PROGRESS')
        ORDER BY due_at ASC LIMIT 5`,
    ).all(warehouseId),
  );
  const openTasks = asSingle<{ count: number }>(
    db.prepare(
      "SELECT COUNT(*) AS count FROM warehouse_tasks WHERE warehouse_id = ? AND status IN ('TODO', 'IN_PROGRESS')",
    ).get(warehouseId),
  )?.count ?? 0;
  const returns = asMany<{ return_number: string }>(
    db.prepare(
      `SELECT r.return_number FROM returns r
         JOIN receiving_records rec ON rec.return_id = r.id
        WHERE rec.warehouse_id = ? AND r.status IN ('RECEIVED', 'INSPECTION')
        ORDER BY r.created_at ASC LIMIT 5`,
    ).all(warehouseId),
  );
  const pendingReturns = asSingle<{ count: number }>(
    db.prepare(
      `SELECT COUNT(*) AS count FROM returns r
         JOIN receiving_records rec ON rec.return_id = r.id
        WHERE rec.warehouse_id = ? AND r.status IN ('RECEIVED', 'INSPECTION')`,
    ).get(warehouseId),
  )?.count ?? 0;
  const operatorsAssigned = asSingle<{ count: number }>(
    db.prepare("SELECT COUNT(*) AS count FROM users WHERE warehouse_id = ? AND role = 'WAREHOUSE'").get(warehouseId),
  )?.count ?? 0;
  return {
    openTasks,
    pendingReturns,
    taskTitles: tasks.map((row) => row.title),
    returnNumbers: returns.map((row) => row.return_number),
    operatorsAssigned,
  };
}

export interface WarehouseDetail extends WarehouseRow {
  locations: Array<{ id: string; code: string; name: string; kind: string; active: number }>;
  operators: Array<{ id: string; email: string; full_name: string; active: number; created_at: string }>;
  recentReceiving: Array<{ id: string; return_id: string; received_quantity: number; created_at: string }>;
  openTasks: Array<{ id: string; title: string; kind: string; status: string; due_at: string }>;
}

/** One site with its locations, operators, recent intake and open work. */
export function getWarehouseAdmin(warehouseId: string): WarehouseDetail {
  const warehouse = loadWarehouse(warehouseId);
  return {
    ...warehouse,
    locations: asMany(
      db.prepare('SELECT id, code, name, kind, active FROM warehouse_locations WHERE warehouse_id = ? ORDER BY code ASC').all(warehouseId),
    ),
    operators: asMany(
      db.prepare("SELECT id, email, full_name, active, created_at FROM users WHERE warehouse_id = ? AND role = 'WAREHOUSE' ORDER BY created_at ASC").all(warehouseId),
    ),
    recentReceiving: asMany(
      db.prepare('SELECT id, return_id, received_quantity, created_at FROM receiving_records WHERE warehouse_id = ? ORDER BY created_at DESC LIMIT 5').all(warehouseId),
    ),
    openTasks: asMany(
      db.prepare(
        "SELECT id, title, kind, status, due_at FROM warehouse_tasks WHERE warehouse_id = ? AND status IN ('TODO', 'IN_PROGRESS') ORDER BY due_at ASC LIMIT 10",
      ).all(warehouseId),
    ),
  };
}

const STANDARD_LOCATIONS: Array<{ kind: string; name: string }> = [
  { kind: 'RECEIVING', name: 'Receiving dock' },
  { kind: 'INSPECTION', name: 'Inspection bench' },
  { kind: 'STOCK', name: 'Sellable stock' },
  { kind: 'DAMAGED', name: 'Damage hold' },
];

export interface WarehouseCreateInput {
  code: string;
  name: string;
  city?: string;
  active?: boolean;
}

export const createWarehouse = db.transaction(
  (actor: Actor, input: WarehouseCreateInput): WarehouseRow => {
    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();
    if (code.length === 0 || name.length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Warehouse code and name are required');
    }
    if (asSingle<{ id: string }>(db.prepare('SELECT id FROM warehouses WHERE code = ?').get(code)) !== undefined) {
      throw new HttpError(409, 'WAREHOUSE_CODE_EXISTS', `A warehouse with code "${code}" already exists`);
    }
    const now = nowIso();
    const row: WarehouseRow = {
      id: id(),
      code,
      name,
      city: input.city?.trim() ?? '',
      active: input.active === false ? 0 : 1,
      created_at: now,
      updated_at: now,
    };
    db.prepare('INSERT INTO warehouses (id, code, name, city, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      row.id, row.code, row.name, row.city, row.active, row.created_at, row.updated_at,
    );
    const insertLocation = db.prepare(
      'INSERT OR IGNORE INTO warehouse_locations (id, warehouse_id, code, name, kind, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
    );
    for (const location of STANDARD_LOCATIONS) {
      insertLocation.run(id(), row.id, `${code}-${location.kind}`, location.name, location.kind, now);
    }
    auditAdminWrite({
      actorId: actor.id, action: 'WAREHOUSE_CREATED', entityType: 'WAREHOUSE', entityId: row.id,
      before: null, after: row, ip: actor.ip,
    });
    return row;
  },
);

export interface WarehousePatch {
  name?: string;
  city?: string;
  active?: boolean;
}

export const updateWarehouse = db.transaction(
  (actor: Actor, warehouseId: string, patch: WarehousePatch): WarehouseRow => {
    const before = loadWarehouse(warehouseId);
    let { name, city, active } = before;
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (trimmed.length === 0) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Warehouse name is required');
      }
      name = trimmed;
    }
    if (patch.city !== undefined) {
      city = patch.city.trim();
    }
    if (patch.active !== undefined) {
      if (patch.active === false && before.active === 1) {
        // Switching a site off strands its floor work and locks out its
        // operators, so open tasks and unprocessed parcels block it by name.
        const blockers = siteBlockers(warehouseId);
        if (blockers.openTasks > 0 || blockers.pendingReturns > 0) {
          throw new HttpError(
            409,
            'WAREHOUSE_HAS_OPEN_WORK',
            `Warehouse "${before.code}" has ${blockers.openTasks} open task(s) and ${blockers.pendingReturns} pending return(s) and cannot be disabled`,
            {
              openTasks: blockers.openTasks,
              pendingReturns: blockers.pendingReturns,
              taskTitles: blockers.taskTitles,
              returnNumbers: blockers.returnNumbers,
              operatorsAssigned: blockers.operatorsAssigned,
            },
          );
        }
        active = 0;
      } else if (patch.active === true) {
        active = 1;
      }
    }
    const now = nowIso();
    db.prepare('UPDATE warehouses SET name = ?, city = ?, active = ?, updated_at = ? WHERE id = ?').run(
      name, city, active, now, warehouseId,
    );
    const after = loadWarehouse(warehouseId);
    auditAdminWrite({
      actorId: actor.id, action: 'WAREHOUSE_UPDATED', entityType: 'WAREHOUSE', entityId: warehouseId,
      before, after, ip: actor.ip,
    });
    return after;
  },
);

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

export interface OperatorRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  warehouse_id: string | null;
  active: number;
  created_at: string;
}

function loadOperator(userId: string): OperatorRow {
  const row = asSingle<OperatorRow>(
    db.prepare('SELECT id, email, full_name, role, warehouse_id, active, created_at FROM users WHERE id = ?').get(userId),
  );
  if (row === undefined || row.role !== 'WAREHOUSE') {
    throw new HttpError(422, 'OPERATOR_INVALID_ROLE', 'Only warehouse operator accounts are managed here');
  }
  return row;
}

/** Live work pinned to one operator: assigned open tasks + parcels they took in. */
export function operatorBlockers(userId: string): {
  assignedOpenTasks: number;
  receivedOpenReturns: number;
  taskTitles: string[];
  returnNumbers: string[];
} {
  const tasks = asMany<{ title: string }>(
    db.prepare(
      `SELECT title FROM warehouse_tasks WHERE assigned_to = ? AND status IN ('TODO', 'IN_PROGRESS')
        ORDER BY due_at ASC LIMIT 5`,
    ).all(userId),
  );
  const assignedOpenTasks = asSingle<{ count: number }>(
    db.prepare(
      "SELECT COUNT(*) AS count FROM warehouse_tasks WHERE assigned_to = ? AND status IN ('TODO', 'IN_PROGRESS')",
    ).get(userId),
  )?.count ?? 0;
  const returns = asMany<{ return_number: string }>(
    db.prepare(
      `SELECT r.return_number FROM returns r
         JOIN receiving_records rec ON rec.return_id = r.id
        WHERE rec.received_by = ? AND r.status NOT IN ('RESOLVED', 'CANCELLED', 'REJECTED')
        ORDER BY r.created_at ASC LIMIT 5`,
    ).all(userId),
  );
  const receivedOpenReturns = asSingle<{ count: number }>(
    db.prepare(
      `SELECT COUNT(*) AS count FROM returns r
         JOIN receiving_records rec ON rec.return_id = r.id
        WHERE rec.received_by = ? AND r.status NOT IN ('RESOLVED', 'CANCELLED', 'REJECTED')`,
    ).get(userId),
  )?.count ?? 0;
  return {
    assignedOpenTasks,
    receivedOpenReturns,
    taskTitles: tasks.map((row) => row.title),
    returnNumbers: returns.map((row) => row.return_number),
  };
}

export interface OperatorCreateInput {
  email: string;
  password: string;
  fullName: string;
  warehouseId: string;
}

export const createOperator = db.transaction(
  (actor: Actor, input: OperatorCreateInput): OperatorRow => {
    const email = input.email.toLowerCase().trim();
    if (input.password.length < 8) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Operator password must be at least 8 characters');
    }
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email) !== undefined) {
      throw new HttpError(409, 'EMAIL_EXISTS', 'An account with this email already exists');
    }
    const site = asSingle<{ id: string; active: number }>(
      db.prepare('SELECT id, active FROM warehouses WHERE id = ?').get(input.warehouseId),
    );
    if (site === undefined) {
      throw new HttpError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found');
    }
    if (site.active !== 1) {
      throw new HttpError(422, 'WAREHOUSE_DISABLED', 'Operators cannot be assigned to a disabled warehouse');
    }
    const now = nowIso();
    const row: OperatorRow = {
      id: id(),
      email,
      full_name: input.fullName.trim(),
      role: 'WAREHOUSE',
      warehouse_id: input.warehouseId,
      active: 1,
      created_at: now,
    };
    if (row.full_name.length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Operator name is required');
    }
    const hash = bcrypt.hashSync(input.password, 10);
    db.prepare(
      'INSERT INTO users (id, email, password_hash, full_name, role, warehouse_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
    ).run(row.id, row.email, hash, row.full_name, row.role, row.warehouse_id, row.created_at);
    // The audit snapshot carries the account, never the password hash.
    auditAdminWrite({
      actorId: actor.id, action: 'OPERATOR_CREATED', entityType: 'USER', entityId: row.id,
      before: null, after: row, ip: actor.ip,
    });
    return row;
  },
);

export interface OperatorPatch {
  warehouseId?: string;
  active?: boolean;
}

export const updateOperator = db.transaction(
  (actor: Actor, userId: string, patch: OperatorPatch): OperatorRow => {
    const before = loadOperator(userId);
    let warehouseId = before.warehouse_id;
    let active = before.active;
    if (patch.warehouseId !== undefined) {
      const site = asSingle<{ id: string; active: number }>(
        db.prepare('SELECT id, active FROM warehouses WHERE id = ?').get(patch.warehouseId),
      );
      if (site === undefined) {
        throw new HttpError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found');
      }
      if (site.active !== 1) {
        throw new HttpError(422, 'WAREHOUSE_DISABLED', 'Operators cannot be assigned to a disabled warehouse');
      }
      warehouseId = patch.warehouseId;
    }
    if (patch.active !== undefined) {
      if (patch.active === false && before.active === 1) {
        const blockers = operatorBlockers(userId);
        if (blockers.assignedOpenTasks > 0 || blockers.receivedOpenReturns > 0) {
          throw new HttpError(
            409,
            'OPERATOR_HAS_OPEN_WORK',
            `Operator "${before.email}" holds ${blockers.assignedOpenTasks} assigned task(s) and ${blockers.receivedOpenReturns} received return(s) still open`,
            {
              assignedOpenTasks: blockers.assignedOpenTasks,
              receivedOpenReturns: blockers.receivedOpenReturns,
              taskTitles: blockers.taskTitles,
              returnNumbers: blockers.returnNumbers,
            },
          );
        }
        active = 0;
      } else if (patch.active === true) {
        active = 1;
      }
    }
    db.prepare('UPDATE users SET warehouse_id = ?, active = ? WHERE id = ?').run(warehouseId, active, userId);
    const after = loadOperator(userId);
    auditAdminWrite({
      actorId: actor.id, action: 'OPERATOR_UPDATED', entityType: 'USER', entityId: userId,
      before: { ...before }, after, ip: actor.ip,
    });
    return after;
  },
);
