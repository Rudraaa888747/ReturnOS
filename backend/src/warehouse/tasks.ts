import { db } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { id, nowIso } from '../utils.js';
import { recordAudit } from './audit.js';
import { getTaskSlaHours } from '../admin/settings.js';
import type { TaskKind, TaskPriority, TaskStatus } from './schema.js';
import type { WarehouseTaskRow } from './types.js';

/**
 * Warehouse work queue.
 *
 * Tasks are created by operations, not by hand: receiving a parcel opens the
 * inspection task, completing an inspection opens the disposition task, and a
 * payout held for approval opens a review task. A task nobody created is work
 * nobody knew about, so the queue is a consequence of the workflow rather
 * than a parallel list somebody has to remember to maintain.
 *
 * Due dates come from the admin settings table (TASK_SLA_HOURS key). When a task passes its due date the
 * breach is stamped once and written to the audit trail, so an SLA miss
 * surfaces on the dashboard instead of passing silently.
 */

export interface CreateTaskInput {
  warehouseId: string;
  kind: TaskKind;
  title: string;
  returnId?: string | null;
  orderId?: string | null;
  priority?: TaskPriority;
  assignedTo?: string | null;
}

function dueAtFor(kind: TaskKind, from: Date): string {
  return new Date(from.getTime() + getTaskSlaHours()[kind] * 3_600_000).toISOString();
}

/**
 * Open a task, unless an identical one is already open.
 *
 * The partial unique index on (kind, return_id) for open tasks makes this safe
 * under retries: a repeated operation reuses the existing task rather than
 * stacking duplicates on the queue.
 */
export function createTask(input: CreateTaskInput): WarehouseTaskRow {
  if (input.returnId !== null && input.returnId !== undefined) {
    const open = db
      .prepare(
        `SELECT * FROM warehouse_tasks
          WHERE kind = ? AND return_id = ? AND status IN ('TODO', 'IN_PROGRESS')`,
      )
      .get(input.kind, input.returnId) as WarehouseTaskRow | undefined;
    if (open !== undefined) {
      return open;
    }
  }

  const now = new Date();
  const taskId = id();
  db.prepare(
    `INSERT INTO warehouse_tasks (id, warehouse_id, kind, title, return_id, order_id, priority, status,
      assigned_to, blocked_reason, created_at, due_at, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'TODO', ?, NULL, ?, ?, NULL, NULL)`,
  ).run(
    taskId,
    input.warehouseId,
    input.kind,
    input.title,
    input.returnId ?? null,
    input.orderId ?? null,
    input.priority ?? 'NORMAL',
    input.assignedTo ?? null,
    now.toISOString(),
    dueAtFor(input.kind, now),
  );
  return db.prepare('SELECT * FROM warehouse_tasks WHERE id = ?').get(taskId) as WarehouseTaskRow;
}

/** Close any open task of this kind for a return. Safe when none exists. */
export function completeTasksFor(returnId: string, kind: TaskKind, actorId: string | null): void {
  const now = nowIso();
  db.prepare(
    `UPDATE warehouse_tasks SET status = 'COMPLETED', completed_at = ?,
       started_at = COALESCE(started_at, ?), assigned_to = COALESCE(assigned_to, ?)
     WHERE return_id = ? AND kind = ? AND status IN ('TODO', 'IN_PROGRESS')`,
  ).run(now, now, actorId, returnId, kind);
}

/** Mark an open task as being worked on. */
export function startTasksFor(returnId: string, kind: TaskKind, actorId: string | null): void {
  const now = nowIso();
  db.prepare(
    `UPDATE warehouse_tasks SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, ?),
       assigned_to = COALESCE(assigned_to, ?)
     WHERE return_id = ? AND kind = ? AND status = 'TODO'`,
  ).run(now, actorId, returnId, kind);
}

export interface TaskView extends WarehouseTaskRow {
  /** Hours remaining against the SLA; negative once overdue. */
  hoursRemaining: number;
  overdue: boolean;
  returnNumber: string | null;
  orderNumber: string | null;
}

function decorate(row: WarehouseTaskRow & { returnNumber: string | null; orderNumber: string | null }): TaskView {
  const remaining = (new Date(row.due_at).getTime() - Date.now()) / 3_600_000;
  const open = row.status === 'TODO' || row.status === 'IN_PROGRESS';
  return {
    ...row,
    hoursRemaining: Math.round(remaining * 10) / 10,
    overdue: open && remaining < 0,
  };
}

/**
 * Stamp tasks that have passed their due date and record the breach once.
 *
 * Called before the task list and the dashboard summary are read, so a breach
 * is noticed by the system rather than only by whoever happens to look.
 */
export function flagOverdueTasks(warehouseId: string): number {
  const now = nowIso();
  const breached = db
    .prepare(
      `SELECT id, kind, title, return_id, due_at FROM warehouse_tasks
        WHERE warehouse_id = ? AND status IN ('TODO', 'IN_PROGRESS')
          AND due_at < ? AND sla_breached_at IS NULL`,
    )
    .all(warehouseId, now) as Array<{
    id: string;
    kind: TaskKind;
    title: string;
    return_id: string | null;
    due_at: string;
  }>;

  if (breached.length === 0) {
    return 0;
  }

  const run = db.transaction(() => {
    const stamp = db.prepare('UPDATE warehouse_tasks SET sla_breached_at = ? WHERE id = ?');
    for (const task of breached) {
      stamp.run(now, task.id);
      recordAudit({
        actorId: null,
        actorRole: 'SYSTEM',
        warehouseId,
        action: 'WARNING_TASK_OVERDUE',
        entityType: 'TASK',
        entityId: task.id,
        previousState: 'WITHIN_SLA',
        newState: 'OVERDUE',
        metadata: {
          kind: task.kind,
          title: task.title,
          returnId: task.return_id,
          dueAt: task.due_at,
          slaHours: getTaskSlaHours()[task.kind],
        },
      });
    }
  });
  run();
  return breached.length;
}

export interface TaskQuery {
  warehouseId: string;
  status?: TaskStatus;
  kind?: TaskKind;
  assignedTo?: string;
  overdueOnly?: boolean;
  limit: number;
  offset: number;
}

export function listTasks(query: TaskQuery): { tasks: TaskView[]; total: number } {
  flagOverdueTasks(query.warehouseId);

  const filters = ['t.warehouse_id = ?'];
  const params: unknown[] = [query.warehouseId];
  if (query.status !== undefined) {
    filters.push('t.status = ?');
    params.push(query.status);
  }
  if (query.kind !== undefined) {
    filters.push('t.kind = ?');
    params.push(query.kind);
  }
  if (query.assignedTo !== undefined) {
    filters.push('t.assigned_to = ?');
    params.push(query.assignedTo);
  }
  if (query.overdueOnly === true) {
    filters.push("t.status IN ('TODO', 'IN_PROGRESS') AND t.due_at < ?");
    params.push(nowIso());
  }
  const where = filters.join(' AND ');

  const total = (
    db.prepare(`SELECT COUNT(*) AS count FROM warehouse_tasks t WHERE ${where}`).get(...params) as { count: number }
  ).count;

  const rows = db
    .prepare(
      `SELECT t.*, r.return_number AS returnNumber, o.order_number AS orderNumber
         FROM warehouse_tasks t
         LEFT JOIN returns r ON r.id = t.return_id
         LEFT JOIN orders o ON o.id = t.order_id
        WHERE ${where}
        ORDER BY CASE t.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'TODO' THEN 1 WHEN 'BLOCKED' THEN 2 ELSE 3 END,
                 t.due_at ASC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, query.limit, query.offset) as Array<
    WarehouseTaskRow & { returnNumber: string | null; orderNumber: string | null }
  >;

  return { tasks: rows.map(decorate), total };
}

function loadTask(warehouseId: string, taskId: string): WarehouseTaskRow {
  const row = db
    .prepare('SELECT * FROM warehouse_tasks WHERE id = ? AND warehouse_id = ?')
    .get(taskId, warehouseId) as WarehouseTaskRow | undefined;
  if (row === undefined) {
    // Same shape as a genuinely missing task, so another site's queue cannot
    // be probed by id.
    throw new HttpError(404, 'TASK_NOT_FOUND', 'Task not found');
  }
  return row;
}

export interface TaskUpdate {
  status?: TaskStatus;
  assignedTo?: string | null;
  priority?: TaskPriority;
  blockedReason?: string | null;
}

/** Update a task and record who changed what. */
export const updateTask = db.transaction(
  (
    operator: { id: string; role: string; warehouseId: string },
    taskId: string,
    update: TaskUpdate,
  ): WarehouseTaskRow => {
    const task = loadTask(operator.warehouseId, taskId);
    if (task.status === 'COMPLETED' && update.status !== undefined && update.status !== 'COMPLETED') {
      throw new HttpError(409, 'TASK_COMPLETED', 'A completed task cannot be reopened');
    }
    if (update.status === 'BLOCKED' && (update.blockedReason ?? '').trim() === '') {
      throw new HttpError(422, 'BLOCKED_REASON_REQUIRED', 'Blocking a task requires a reason');
    }

    const now = nowIso();
    const nextStatus = update.status ?? task.status;
    db.prepare(
      `UPDATE warehouse_tasks SET
         status = ?,
         assigned_to = ?,
         priority = ?,
         blocked_reason = ?,
         started_at = CASE WHEN ? IN ('IN_PROGRESS', 'COMPLETED') THEN COALESCE(started_at, ?) ELSE started_at END,
         completed_at = CASE WHEN ? = 'COMPLETED' THEN COALESCE(completed_at, ?) ELSE NULL END
       WHERE id = ?`,
    ).run(
      nextStatus,
      update.assignedTo === undefined ? task.assigned_to : update.assignedTo,
      update.priority ?? task.priority,
      update.status === 'BLOCKED' ? (update.blockedReason ?? null) : null,
      nextStatus,
      now,
      nextStatus,
      now,
      task.id,
    );

    recordAudit({
      actorId: operator.id,
      actorRole: operator.role,
      warehouseId: operator.warehouseId,
      action: 'TASK_UPDATED',
      entityType: 'TASK',
      entityId: task.id,
      previousState: task.status,
      newState: nextStatus,
      metadata: {
        kind: task.kind,
        assignedTo: update.assignedTo === undefined ? task.assigned_to : update.assignedTo,
        priority: update.priority ?? task.priority,
      },
    });

    return db.prepare('SELECT * FROM warehouse_tasks WHERE id = ?').get(task.id) as WarehouseTaskRow;
  },
);

export interface TaskCounts {
  todo: number;
  inProgress: number;
  blocked: number;
  completedToday: number;
  overdue: number;
}

/** Task counts for the dashboard. Overdue is stamped before counting. */
export function taskCounts(warehouseId: string): TaskCounts {
  flagOverdueTasks(warehouseId);
  const now = nowIso();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'TODO' THEN 1 ELSE 0 END) AS todo,
         SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS inProgress,
         SUM(CASE WHEN status = 'BLOCKED' THEN 1 ELSE 0 END) AS blocked,
         SUM(CASE WHEN status = 'COMPLETED' AND completed_at >= ? THEN 1 ELSE 0 END) AS completedToday,
         SUM(CASE WHEN status IN ('TODO', 'IN_PROGRESS') AND due_at < ? THEN 1 ELSE 0 END) AS overdue
       FROM warehouse_tasks WHERE warehouse_id = ?`,
    )
    .get(dayAgo, now, warehouseId) as Record<keyof TaskCounts, number | null>;

  return {
    todo: row.todo ?? 0,
    inProgress: row.inProgress ?? 0,
    blocked: row.blocked ?? 0,
    completedToday: row.completedToday ?? 0,
    overdue: row.overdue ?? 0,
  };
}

/** The most pressing overdue tasks, for the dashboard banner. */
export function overdueTasks(warehouseId: string, limit: number): TaskView[] {
  return listTasks({ warehouseId, overdueOnly: true, limit, offset: 0 }).tasks;
}
