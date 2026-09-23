import { db } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { id, nowIso } from '../utils.js';
import { auditAdminWrite } from './audit.js';
import { notifyCustomer } from './notifications.js';

/**
 * Admin support: global ticket visibility, assignment, status, and replies.
 *
 * Replies are authored as ADMIN (the author_role widening keeps CUSTOMER
 * and SYSTEM rows exactly as they were). Every admin action here notifies
 * the customer through their template with a literal fallback, so a
 * missing template degrades to plain wording instead of silence.
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

export interface AdminTicketRow {
  id: string;
  ticket_number: string;
  user_id: string;
  customer_email: string;
  customer_name: string;
  return_id: string | null;
  return_number: string | null;
  subject: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  assignee_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketListQuery {
  search?: string;
  status?: string;
  priority?: string;
  assignedTo?: string;
  customerId?: string;
  limit: number;
  offset: number;
}

/** Every ticket, every customer. Explicit columns throughout. */
export function listTicketsAdmin(query: TicketListQuery): { tickets: AdminTicketRow[]; total: number } {
  const filters: string[] = [];
  const params: unknown[] = [];
  if (query.search !== undefined && query.search.trim() !== '') {
    const term = `%${query.search.trim().toLowerCase()}%`;
    filters.push('(LOWER(t.ticket_number) LIKE ? OR LOWER(t.subject) LIKE ? OR LOWER(u.email) LIKE ?)');
    params.push(term, term, term);
  }
  if (query.status !== undefined && query.status !== '') {
    filters.push('t.status = ?');
    params.push(query.status);
  }
  if (query.priority !== undefined && query.priority !== '') {
    filters.push('t.priority = ?');
    params.push(query.priority);
  }
  if (query.assignedTo !== undefined && query.assignedTo !== '') {
    filters.push('t.assigned_to = ?');
    params.push(query.assignedTo);
  }
  if (query.customerId !== undefined && query.customerId !== '') {
    filters.push('t.user_id = ?');
    params.push(query.customerId);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const from = `FROM support_tickets t JOIN users u ON u.id = t.user_id
    LEFT JOIN users a ON a.id = t.assigned_to LEFT JOIN returns r ON r.id = t.return_id`;
  const total = asSingle<{ count: number }>(
    db.prepare(`SELECT COUNT(*) AS count ${from} ${where}`).get(...params),
  )?.count ?? 0;
  const tickets = asMany<AdminTicketRow>(
    db.prepare(
      `SELECT t.id, t.ticket_number, t.user_id, u.email AS customer_email, u.full_name AS customer_name,
              t.return_id, r.return_number, t.subject, t.status, t.priority,
              t.assigned_to, a.email AS assignee_email, t.created_at, t.updated_at
         ${from} ${where} ORDER BY t.updated_at DESC LIMIT ? OFFSET ?`,
    ).all(...params, query.limit, query.offset),
  );
  return { tickets, total };
}

export interface AdminTicketDetail {
  ticket: AdminTicketRow;
  messages: AdminTicketMessage[];
}

export interface AdminTicketMessage {
  id: string;
  author_role: string;
  body: string;
  created_at: string;
}

export function getTicketAdmin(ticketId: string): AdminTicketDetail | null {
  const ticket = asSingle<AdminTicketRow>(
    db.prepare(
      `SELECT t.id, t.ticket_number, t.user_id, u.email AS customer_email, u.full_name AS customer_name,
              t.return_id, r.return_number, t.subject, t.status, t.priority,
              t.assigned_to, a.email AS assignee_email, t.created_at, t.updated_at
         FROM support_tickets t JOIN users u ON u.id = t.user_id
         LEFT JOIN users a ON a.id = t.assigned_to LEFT JOIN returns r ON r.id = t.return_id
        WHERE t.id = ?`,
    ).get(ticketId),
  );
  if (ticket === undefined) {
    return null;
  }
  const messages = asMany<AdminTicketMessage>(
    db.prepare('SELECT id, author_role, body, created_at FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC').all(ticketId),
  );
  return { ticket, messages };
}

function loadTicket(ticketId: string): { id: string; user_id: string; status: string; priority: string } {
  const row = asSingle<{ id: string; user_id: string; status: string; priority: string }>(
    db.prepare('SELECT id, user_id, status, priority FROM support_tickets WHERE id = ?').get(ticketId),
  );
  if (row === undefined) {
    throw new HttpError(404, 'TICKET_NOT_FOUND', 'Support ticket not found');
  }
  return row;
}

export const assignTicket = db.transaction(
  (actor: Actor, ticketId: string, assignedTo: string | null): AdminTicketRow => {
    const before = loadTicket(ticketId);
    if (assignedTo !== null) {
      const assignee = asSingle<{ id: string; role: string }>(
        db.prepare('SELECT id, role FROM users WHERE id = ?').get(assignedTo),
      );
      if (assignee === undefined || (assignee.role !== 'ADMIN' && assignee.role !== 'WAREHOUSE')) {
        throw new HttpError(422, 'ASSIGNEE_INVALID', 'Tickets may only be assigned to admin or warehouse accounts');
      }
    }
    const now = nowIso();
    db.prepare('UPDATE support_tickets SET assigned_to = ?, updated_at = ? WHERE id = ?').run(assignedTo, now, ticketId);
    const detail = getTicketAdmin(ticketId);
    if (detail === null) {
      throw new HttpError(500, 'TICKET_ERROR', 'Ticket could not be loaded after assignment');
    }
    auditAdminWrite({
      actorId: actor.id, action: 'TICKET_ASSIGNED', entityType: 'TICKET', entityId: ticketId,
      before: { assigned_to: before }, after: { assigned_to: assignedTo }, ip: actor.ip,
    });
    return detail.ticket;
  },
);

export const setTicketStatus = db.transaction(
  (actor: Actor, ticketId: string, status: 'OPEN' | 'CLOSED'): AdminTicketRow => {
    const ticket = loadTicket(ticketId);
    const now = nowIso();
    db.prepare('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?').run(status, now, ticketId);
    const detail = getTicketAdmin(ticketId);
    if (detail === null) {
      throw new HttpError(500, 'TICKET_ERROR', 'Ticket could not be loaded after update');
    }
    auditAdminWrite({
      actorId: actor.id, action: status === 'CLOSED' ? 'TICKET_CLOSED' : 'TICKET_REOPENED',
      entityType: 'TICKET', entityId: ticketId,
      before: { status: ticket.status }, after: { status }, ip: actor.ip,
    });
    if (status === 'CLOSED') {
      notifyCustomer(ticket.user_id, 'TICKET_CLOSED', { ticket_number: detail.ticket.ticket_number }, {
        returnId: null,
        type: 'SUPPORT_UPDATE',
        title: `Ticket ${detail.ticket.ticket_number} closed`,
        body: `Your support ticket "${detail.ticket.subject}" was closed. Reply to reopen it.`,
      });
    }
    return detail.ticket;
  },
);

export const setTicketPriority = db.transaction(
  (actor: Actor, ticketId: string, priority: string): AdminTicketRow => {
    const ticket = loadTicket(ticketId);
    const now = nowIso();
    db.prepare('UPDATE support_tickets SET priority = ?, updated_at = ? WHERE id = ?').run(priority, now, ticketId);
    const detail = getTicketAdmin(ticketId);
    if (detail === null) {
      throw new HttpError(500, 'TICKET_ERROR', 'Ticket could not be loaded after update');
    }
    auditAdminWrite({
      actorId: actor.id, action: 'TICKET_PRIORITY_SET', entityType: 'TICKET', entityId: ticketId,
      before: { priority: ticket.priority }, after: { priority }, ip: actor.ip,
    });
    return detail.ticket;
  },
);

export const replyTicket = db.transaction(
  (actor: Actor, ticketId: string, body: string): { id: string; created_at: string } => {
    const ticket = loadTicket(ticketId);
    if (ticket.status === 'CLOSED') {
      throw new HttpError(409, 'TICKET_CLOSED', 'Closed tickets cannot receive new messages');
    }
    const text = body.trim();
    if (text.length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Reply body is required');
    }
    const now = nowIso();
    const messageId = id();
    db.prepare(
      'INSERT INTO support_messages (id, ticket_id, author_role, body, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(messageId, ticketId, 'ADMIN', text, now);
    db.prepare('UPDATE support_tickets SET updated_at = ? WHERE id = ?').run(now, ticketId);
    const detail = getTicketAdmin(ticketId);
    auditAdminWrite({
      actorId: actor.id, action: 'TICKET_REPLIED', entityType: 'TICKET', entityId: ticketId,
      before: null, after: { message_id: messageId }, ip: actor.ip,
    });
    notifyCustomer(ticket.user_id, 'TICKET_REPLIED', { ticket_number: detail?.ticket.ticket_number ?? ticketId }, {
      returnId: null,
      type: 'SUPPORT_UPDATE',
      title: 'New reply on your support ticket',
      body: 'Support replied to your ticket. Open it to read the response.',
    });
    return { id: messageId, created_at: now };
  },
);
