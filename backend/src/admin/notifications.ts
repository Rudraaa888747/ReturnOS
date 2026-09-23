import { db } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { nowIso } from '../utils.js';
import { createNotification } from '../store.js';
import { auditAdminWrite } from './audit.js';

/**
 * Admin notification inspection, template management, and the single
 * template-aware sender other admin modules use.
 *
 * Templates render {{variables}} and are validated on save; sending always
 * carries a literal fallback so a missing or disabled template degrades to
 * plain wording instead of silence.
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

export interface AdminNotificationRow {
  id: string;
  user_id: string;
  user_email: string;
  return_id: string | null;
  return_number: string | null;
  type: string;
  title: string;
  body: string;
  is_read: number;
  created_at: string;
}

export interface NotificationListQuery {
  search?: string;
  type?: string;
  userId?: string;
  unreadOnly?: boolean;
  limit: number;
  offset: number;
}

/** Global notification activity with recipient mapping. */
export function listNotificationsAdmin(query: NotificationListQuery): {
  notifications: AdminNotificationRow[];
  total: number;
} {
  const filters: string[] = [];
  const params: unknown[] = [];
  if (query.search !== undefined && query.search.trim() !== '') {
    const term = `%${query.search.trim().toLowerCase()}%`;
    filters.push('(LOWER(u.email) LIKE ? OR LOWER(n.title) LIKE ? OR LOWER(n.body) LIKE ?)');
    params.push(term, term, term);
  }
  if (query.type !== undefined && query.type !== '') {
    filters.push('n.type = ?');
    params.push(query.type);
  }
  if (query.userId !== undefined && query.userId !== '') {
    filters.push('n.user_id = ?');
    params.push(query.userId);
  }
  if (query.unreadOnly === true) {
    filters.push('n.is_read = 0');
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const from = `FROM notifications n JOIN users u ON u.id = n.user_id LEFT JOIN returns r ON r.id = n.return_id`;
  const total = asSingle<{ count: number }>(
    db.prepare(`SELECT COUNT(*) AS count ${from} ${where}`).get(...params),
  )?.count ?? 0;
  const notifications = asMany<AdminNotificationRow>(
    db.prepare(
      `SELECT n.id, n.user_id, u.email AS user_email, n.return_id, r.return_number,
              n.type, n.title, n.body, n.is_read, n.created_at
         ${from} ${where} ORDER BY n.created_at DESC LIMIT ? OFFSET ?`,
    ).all(...params, query.limit, query.offset),
  );
  return { notifications, total };
}

export interface NotificationTemplate {
  key: string;
  title: string;
  body: string;
  active: number;
  updated_at: string;
}

/** Render {{variables}}; unknown keys are left untouched, never dropped. */
export function renderNotificationTemplate(
  template: Pick<NotificationTemplate, 'title' | 'body'>,
  vars: Record<string, string>,
): { title: string; body: string } {
  const fill = (text: string): string =>
    text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match,
    );
  return { title: fill(template.title), body: fill(template.body) };
}

/** All templates, active and retired. */
export function listTemplatesAdmin(): { templates: NotificationTemplate[] } {
  const templates = asMany<NotificationTemplate>(
    db.prepare('SELECT * FROM notification_templates ORDER BY key ASC').all(),
  );
  return { templates };
}

export interface TemplateUpsert {
  title: string;
  body: string;
  active?: boolean;
}

export const upsertTemplate = db.transaction(
  (actor: Actor, key: string, input: TemplateUpsert): NotificationTemplate => {
    const normalized = key.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,59}$/.test(normalized)) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Template key must start with a letter and contain only A-Z, 0-9 and underscore');
    }
    const title = input.title.trim();
    const body = input.body.trim();
    if (title.length === 0 || body.length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Template title and body are required');
    }
    const before = asSingle<NotificationTemplate>(
      db.prepare('SELECT * FROM notification_templates WHERE key = ?').get(normalized),
    ) ?? null;
    const now = nowIso();
    const active = input.active === false ? 0 : (before?.active ?? 1);
    db.prepare(
      `INSERT INTO notification_templates (key, title, body, active, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET title = excluded.title, body = excluded.body, active = excluded.active, updated_at = excluded.updated_at`,
    ).run(normalized, title, body, active, now);
    const after = asSingle<NotificationTemplate>(
      db.prepare('SELECT * FROM notification_templates WHERE key = ?').get(normalized),
    );
    if (after === undefined) {
      throw new HttpError(500, 'TEMPLATE_ERROR', 'Template could not be loaded after save');
    }
    auditAdminWrite({
      actorId: actor.id, action: 'TEMPLATE_SAVED', entityType: 'TEMPLATE', entityId: normalized,
      before, after, ip: actor.ip,
    });
    return after;
  },
);

/**
 * Notify a customer through a template, falling back to literals when the
 * template is missing or disabled. Returns which path was taken.
 */
export function notifyCustomer(
  userId: string,
  templateKey: string,
  vars: Record<string, string>,
  fallback: { returnId?: string | null; type: string; title: string; body: string },
): { via: 'template' | 'fallback' } {
  const template = asSingle<NotificationTemplate>(
    db.prepare('SELECT * FROM notification_templates WHERE key = ? AND active = 1').get(templateKey),
  );
  if (template !== undefined) {
    const rendered = renderNotificationTemplate(template, vars);
    createNotification(userId, {
      returnId: fallback.returnId ?? undefined,
      type: fallback.type,
      title: rendered.title,
      body: rendered.body,
    });
    return { via: 'template' };
  }
  createNotification(userId, {
    returnId: fallback.returnId ?? undefined,
    type: fallback.type,
    title: fallback.title,
    body: fallback.body,
  });
  return { via: 'fallback' };
}

/** Seed the templates the admin flows reference. Never overwrites edits. */
export function seedTemplates(): void {
  const defaults: Array<{ key: string; title: string; body: string }> = [
    {
      key: 'TICKET_REPLIED',
      title: 'New reply on ticket {{ticket_number}}',
      body: 'Support replied to your ticket {{ticket_number}}. Open it to read the response.',
    },
    {
      key: 'TICKET_CLOSED',
      title: 'Ticket {{ticket_number}} closed',
      body: 'Your support ticket {{ticket_number}} was closed. Reply to reopen it.',
    },
  ];
  const now = nowIso();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO notification_templates (key, title, body, active, updated_at) VALUES (?, ?, ?, 1, ?)',
  );
  const run = db.transaction(() => {
    for (const template of defaults) {
      insert.run(template.key, template.title, template.body, now);
    }
  });
  run();
}
