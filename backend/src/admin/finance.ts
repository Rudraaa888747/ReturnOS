import { db } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { addLedgerEntry, creditBalance } from '../store.js';
import type { LedgerRow } from '../store.js';
import { auditAdminWrite } from './audit.js';

/**
 * Admin store-credit adjustments and financial visibility.
 *
 * Adjustments go through the SAME addLedgerEntry the resolve engine uses,
 * with an ADMIN_ADJUSTMENT reference type, so the UNIQUE(reference_type,
 * reference_id) dedupe protects admin writes exactly like payouts. Every
 * adjustment is dual-stamped: the ledger entry (the money) and an
 * admin_audit_log row carrying before/after balances (the justification
 * trail). A justification reason is mandatory — no reason, no write.
 *
 * Refunds are READ-ONLY here by design: every legitimate transition is
 * owned by resolveReturnAtResolved (COMPLETED at resolve) or cancelReturn
 * (CANCELLED at cancel). No admin action may bypass that engine.
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

export interface CreditAdjustmentInput {
  userId: string;
  direction: 'CREDIT' | 'DEBIT';
  amountPaise: number;
  reason: string;
  key: string;
}

export interface CreditAdjustmentResult {
  entry: LedgerRow;
  balancePaise: number;
  replayed: boolean;
}

export const adjustCredit = db.transaction(
  (actor: Actor, input: CreditAdjustmentInput): CreditAdjustmentResult => {
    const user = asSingle<{ id: string; role: string }>(
      db.prepare('SELECT id, role FROM users WHERE id = ?').get(input.userId),
    );
    if (user === undefined) {
      throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
    }
    if (user.role !== 'CUSTOMER') {
      throw new HttpError(422, 'CREDIT_USER_INVALID', 'Store credit adjustments apply to customer accounts only');
    }
    if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Amount must be a positive integer number of paise');
    }
    const reason = input.reason.trim();
    if (reason.length < 8) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'A justification reason of at least 8 characters is required');
    }

    const before = creditBalance(input.userId);
    if (input.direction === 'DEBIT' && input.amountPaise > before) {
      throw new HttpError(409, 'INSUFFICIENT_CREDIT', `Balance ${before} paise cannot cover a debit of ${input.amountPaise} paise`);
    }

    // Replay first: the same key returns the original entry with no new
    // financial effect and no second audit row.
    const prior = asSingle<LedgerRow>(
      db.prepare("SELECT * FROM store_credit_ledger WHERE reference_type = 'ADMIN_ADJUSTMENT' AND reference_id = ?").get(input.key),
    );
    if (prior !== undefined) {
      return { entry: prior, balancePaise: before, replayed: true };
    }

    const entry = addLedgerEntry({
      userId: input.userId,
      type: input.direction,
      amountPaise: input.direction === 'DEBIT' ? -input.amountPaise : input.amountPaise,
      reason,
      referenceType: 'ADMIN_ADJUSTMENT',
      referenceId: input.key,
    });
    const after = before + (input.direction === 'DEBIT' ? -input.amountPaise : input.amountPaise);
    auditAdminWrite({
      actorId: actor.id,
      action: 'CREDIT_ADJUSTED',
      entityType: 'STORE_CREDIT',
      entityId: entry.id,
      before: { balancePaise: before },
      after: { balancePaise: after },
      metadata: { direction: input.direction, amountPaise: input.amountPaise, key: input.key, reason, userId: input.userId },
      ip: actor.ip,
    });
    return { entry, balancePaise: after, replayed: false };
  },
);

export interface LedgerListQuery {
  userId?: string;
  type?: string;
  referenceType?: string;
  limit: number;
  offset: number;
}

/** Global ledger with customer mapping. Explicit columns; balances computed. */
export function listLedgerAdmin(query: LedgerListQuery): {
  entries: Array<LedgerRow & { user_email: string }>;
  total: number;
} {
  const filters: string[] = [];
  const params: unknown[] = [];
  if (query.userId !== undefined && query.userId !== '') {
    filters.push('l.user_id = ?');
    params.push(query.userId);
  }
  if (query.type !== undefined && query.type !== '') {
    filters.push('l.type = ?');
    params.push(query.type);
  }
  if (query.referenceType !== undefined && query.referenceType !== '') {
    filters.push('l.reference_type = ?');
    params.push(query.referenceType);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const total = asSingle<{ count: number }>(
    db.prepare(`SELECT COUNT(*) AS count FROM store_credit_ledger l ${where}`).get(...params),
  )?.count ?? 0;
  const entries = asMany<LedgerRow & { user_email: string }>(
    db.prepare(
      `SELECT l.id, l.user_id, l.type, l.amount_paise, l.reason, l.reference_type, l.reference_id,
              l.created_at, u.email AS user_email
         FROM store_credit_ledger l
         JOIN users u ON u.id = l.user_id
        ${where} ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`,
    ).all(...params, query.limit, query.offset),
  );
  return { entries, total };
}

/** Non-zero balances ordered by magnitude, for the overview screen. */
export function listBalancesAdmin(limit: number): {
  balances: Array<{ user_id: string; user_email: string; balance_paise: number }>;
} {
  const balances = asMany<{ user_id: string; user_email: string; balance_paise: number }>(
    db.prepare(
      `SELECT l.user_id, u.email AS user_email, SUM(l.amount_paise) AS balance_paise
         FROM store_credit_ledger l JOIN users u ON u.id = l.user_id
        GROUP BY l.user_id HAVING balance_paise != 0
        ORDER BY ABS(balance_paise) DESC LIMIT ?`,
    ).all(limit),
  );
  return { balances };
}

export interface RefundListQuery {
  search?: string;
  status?: string;
  kind?: string;
  limit: number;
  offset: number;
}

export interface AdminRefundRow {
  id: string;
  return_id: string;
  return_number: string;
  order_id: string;
  order_number: string | null;
  customer_id: string;
  customer_email: string;
  kind: string;
  amount_paise: number | null;
  method: string | null;
  status: string;
  initiated_at: string | null;
  completed_at: string | null;
}

/** Every refund with its return/order/customer linkage. Read-only by design. */
export function listRefundsAdmin(query: RefundListQuery): { refunds: AdminRefundRow[]; total: number } {
  const filters: string[] = [];
  const params: unknown[] = [];
  if (query.search !== undefined && query.search.trim() !== '') {
    const term = `%${query.search.trim().toLowerCase()}%`;
    filters.push(`(LOWER(r.return_number) LIKE ? OR LOWER(o.order_number) LIKE ? OR LOWER(u.email) LIKE ?)`);
    params.push(term, term, term);
  }
  if (query.status !== undefined && query.status !== '') {
    filters.push('f.status = ?');
    params.push(query.status);
  }
  if (query.kind !== undefined && query.kind !== '') {
    filters.push('f.kind = ?');
    params.push(query.kind);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const from = `FROM refunds f JOIN returns r ON r.id = f.return_id
    LEFT JOIN orders o ON o.id = r.order_id JOIN users u ON u.id = r.customer_id`;
  const total = asSingle<{ count: number }>(
    db.prepare(`SELECT COUNT(*) AS count ${from} ${where}`).get(...params),
  )?.count ?? 0;
  const refunds = asMany<AdminRefundRow>(
    db.prepare(
      `SELECT f.id, f.return_id, r.return_number, r.order_id, o.order_number,
              r.customer_id, u.email AS customer_email, f.kind, f.amount_paise, f.method,
              f.status, f.initiated_at, f.completed_at
         ${from} ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    ).all(...params, query.limit, query.offset),
  );
  return { refunds, total };
}

/** One refund with its full context. Null for unknown ids. */
export function getRefundAdmin(refundId: string): AdminRefundRow | null {
  return asSingle<AdminRefundRow>(
    db.prepare(
      `SELECT f.id, f.return_id, r.return_number, r.order_id, o.order_number,
              r.customer_id, u.email AS customer_email, f.kind, f.amount_paise, f.method,
              f.status, f.initiated_at, f.completed_at
         FROM refunds f JOIN returns r ON r.id = f.return_id
         LEFT JOIN orders o ON o.id = r.order_id JOIN users u ON u.id = r.customer_id
        WHERE f.id = ?`,
    ).get(refundId),
  ) ?? null;
}
