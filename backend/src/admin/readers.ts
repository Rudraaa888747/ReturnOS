import { db } from '../db.js';
import { warehouseAnalytics } from '../warehouse/analytics.js';

/**
 * Admin read layer: cross-customer, cross-warehouse visibility.
 *
 * COLUMN RULE (audited per query, do not relax): user rows are always
 * selected column-by-column and never include password_hash, password
 * reset tokens, or session material. Customer-scoped helpers in store.ts
 * were checked field-by-field before reuse was allowed — most admin reads
 * below are dedicated queries because the customer functions scope by
 * owner (which is exactly what admin must not do) or select whole rows.
 *
 * Every metric is a live query. Nothing here stores or caches a copy.
 */

function asSingle<T>(value: unknown): T | undefined {
  return value as T | undefined;
}

function asMany<T>(value: unknown): T[] {
  return value as T[];
}

function dayStartIso(daysAgo = 0): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString();
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** Validated sort direction; anything but DESC becomes ASC. */
/**
 * Sanitize a sort direction, honouring an explicit request and otherwise
 * falling back to the caller's default.
 *
 * The fallback matters: a list of orders or returns is read newest-first by
 * anyone looking at what is happening now, so those lists pass 'DESC'. An
 * alphabetical list passes 'ASC'. Only these two values ever reach SQL.
 */
export function sortDir(raw: unknown, fallback: 'ASC' | 'DESC' = 'ASC'): 'ASC' | 'DESC' {
  const requested = String(raw ?? '').toUpperCase();
  if (requested === 'DESC') return 'DESC';
  if (requested === 'ASC') return 'ASC';
  return fallback;
}

function count(table: string, where: string, ...params: unknown[]): number {
  const row = asSingle<{ count: number }>(
    db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get(...params),
  );
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface AdminDashboard {
  commerce: {
    totalOrders: number;
    ordersToday: number;
    pendingOrders: number;
    deliveredOrders: number;
    cancelledOrders: number;
  };
  returns: {
    totalReturns: number;
    newReturns: number;
    pendingReceiving: number;
    pendingInspection: number;
    pendingDisposition: number;
    completedReturns: number;
  };
  financial: {
    refundsPending: number;
    refundsCompleted: number;
    refundsCompletedPaise: number;
    creditIssuedPaise: number;
    creditUsedPaise: number;
  };
  warehouse: {
    pendingTasks: number;
    overdueTasks: number;
    inventoryAlerts: number;
  };
  recovery: {
    recoveredValuePaise: number;
    restockedUnits: number;
    resaleUnits: number;
    repairUnits: number;
    vendorReturnUnits: number;
    disposalUnits: number;
  };
  customers: {
    totalCustomers: number;
    newCustomers: number;
    activeCustomers: number;
  };
  pendingReturns: Array<{ id: string; return_number: string; status: string; created_at: string }>;
  pendingRefunds: Array<{ id: string; return_number: string; amount_paise: number; status: string }>;
  warehouseAlerts: Array<{ action: string; count: number }>;
  overdueTasksList: Array<{ id: string; title: string; kind: string; due_at: string }>;
  inventoryIssues: Array<{ action: string; count: number }>;
  openTickets: Array<{ id: string; ticket_number: string; subject: string; status: string }>;
  recentOrders: Array<{ id: string; order_number: string; status: string; created_at: string }>;
  recentReturns: Array<{ id: string; return_number: string; status: string; created_at: string }>;
  recentAdminActivity: Array<{ id: string; action: string; entity_type: string; created_at: string }>;
}

const NON_TERMINAL_RETURNS = `status NOT IN ('RESOLVED', 'CANCELLED', 'REJECTED')`;

/** Full operational overview. Every number below is computed live. */
export function adminDashboard(): AdminDashboard {
  const today = dayStartIso(0);
  const week = dayStartIso(7);
  const month = sinceIso(30);
  const day = sinceIso(1);

  const pendingDisposition = asSingle<{ count: number }>(
    db.prepare(
      `SELECT COUNT(DISTINCT ri.return_id) AS count FROM return_items ri
        JOIN inspections i ON i.return_id = ri.return_id
       WHERE i.completed_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM dispositions d WHERE d.return_item_id = ri.id)`,
    ).get(),
  )?.count ?? 0;

  const credit = asSingle<{ issued: number; used: number }>(
    db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount_paise ELSE 0 END), 0) AS issued,
              COALESCE(SUM(CASE WHEN type = 'DEBIT' THEN -amount_paise ELSE 0 END), 0) AS used
         FROM store_credit_ledger`,
    ).get(),
  ) ?? { issued: 0, used: 0 };

  const recoveryUnits = (action: string): number =>
    asSingle<{ quantity: number }>(
      db.prepare('SELECT COALESCE(SUM(quantity), 0) AS quantity FROM dispositions WHERE action = ?').get(action),
    )?.quantity ?? 0;

  return {
    commerce: {
      totalOrders: count('orders', '1 = 1'),
      ordersToday: count('orders', 'created_at >= ?', today),
      pendingOrders: count('orders', "status NOT IN ('DELIVERED', 'CANCELLED')"),
      deliveredOrders: count('orders', "status = 'DELIVERED'"),
      cancelledOrders: count('orders', "status = 'CANCELLED'"),
    },
    returns: {
      totalReturns: count('returns', '1 = 1'),
      newReturns: count('returns', "status = 'REQUESTED'"),
      pendingReceiving: count('returns', "status IN ('APPROVED', 'PICKED_UP', 'IN_TRANSIT')"),
      pendingInspection: count('returns', "status = 'RECEIVED'"),
      pendingDisposition,
      completedReturns: count('returns', "status = 'RESOLVED'"),
    },
    financial: {
      refundsPending: count('refunds', "status = 'PENDING'"),
      refundsCompleted: count('refunds', "status = 'COMPLETED'"),
      refundsCompletedPaise: asSingle<{ total: number }>(
        db.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS total FROM refunds WHERE status = 'COMPLETED'").get(),
      )?.total ?? 0,
      creditIssuedPaise: credit.issued,
      creditUsedPaise: credit.used,
    },
    warehouse: {
      pendingTasks: count('warehouse_tasks', "status IN ('TODO', 'IN_PROGRESS')"),
      overdueTasks: count('warehouse_tasks', "status IN ('TODO', 'IN_PROGRESS') AND due_at < ?", new Date().toISOString()),
      inventoryAlerts: asSingle<{ count: number }>(
        db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action LIKE 'WARNING_%' AND created_at >= ?").get(day),
      )?.count ?? 0,
    },
    recovery: {
      recoveredValuePaise: asSingle<{ total: number }>(
        db.prepare('SELECT COALESCE(SUM(recovery_value_paise), 0) AS total FROM dispositions').get(),
      )?.total ?? 0,
      restockedUnits: recoveryUnits('RESTOCK'),
      resaleUnits: recoveryUnits('RESELL'),
      repairUnits: recoveryUnits('REPAIR'),
      vendorReturnUnits: recoveryUnits('RETURN_TO_VENDOR'),
      disposalUnits: recoveryUnits('DISPOSE'),
    },
    customers: {
      totalCustomers: count('users', "role = 'CUSTOMER'"),
      newCustomers: count('users', "role = 'CUSTOMER' AND created_at >= ?", week),
      activeCustomers: asSingle<{ count: number }>(
        db.prepare('SELECT COUNT(DISTINCT customer_id) AS count FROM orders WHERE created_at >= ?').get(month),
      )?.count ?? 0,
    },
    pendingReturns: asMany<{ id: string; return_number: string; status: string; created_at: string }>(
      db.prepare(`SELECT id, return_number, status, created_at FROM returns WHERE ${NON_TERMINAL_RETURNS} ORDER BY created_at DESC LIMIT 5`).all(),
    ),
    pendingRefunds: asMany<{ id: string; return_number: string; amount_paise: number; status: string }>(
      db.prepare(
        `SELECT f.id, r.return_number, f.amount_paise, f.status FROM refunds f
          JOIN returns r ON r.id = f.return_id
         WHERE f.status = 'PENDING' ORDER BY r.created_at DESC LIMIT 5`,
      ).all(),
    ),
    warehouseAlerts: asMany<{ action: string; count: number }>(
      db.prepare(
        `SELECT action, COUNT(*) AS count FROM audit_log
          WHERE action LIKE 'WARNING_%' AND created_at >= ? GROUP BY action ORDER BY count DESC`,
      ).all(day),
    ),
    overdueTasksList: asMany<{ id: string; title: string; kind: string; due_at: string }>(
      db.prepare(
        `SELECT id, title, kind, due_at FROM warehouse_tasks
          WHERE status IN ('TODO', 'IN_PROGRESS') AND due_at < ?
          ORDER BY due_at ASC LIMIT 5`,
      ).all(new Date().toISOString()),
    ),
    inventoryIssues: asMany<{ action: string; count: number }>(
      db.prepare(
        `SELECT action, COUNT(*) AS count FROM audit_log
          WHERE (action LIKE '%INVENTORY%' OR action LIKE '%SHORTFALL%' OR action LIKE '%FALLBACK%')
            AND created_at >= ? GROUP BY action ORDER BY count DESC`,
      ).all(day),
    ),
    openTickets: asMany<{ id: string; ticket_number: string; subject: string; status: string }>(
      db.prepare(
        "SELECT id, ticket_number, subject, status FROM support_tickets WHERE status = 'OPEN' ORDER BY created_at DESC LIMIT 5",
      ).all(),
    ),
    recentOrders: asMany<{ id: string; order_number: string; status: string; created_at: string }>(
      db.prepare('SELECT id, order_number, status, created_at FROM orders ORDER BY created_at DESC LIMIT 5').all(),
    ),
    recentReturns: asMany<{ id: string; return_number: string; status: string; created_at: string }>(
      db.prepare('SELECT id, return_number, status, created_at FROM returns ORDER BY created_at DESC LIMIT 5').all(),
    ),
    recentAdminActivity: asMany<{ id: string; action: string; entity_type: string; created_at: string }>(
      db.prepare('SELECT id, action, entity_type, created_at FROM admin_audit_log ORDER BY created_at DESC LIMIT 5').all(),
    ),
  };
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export interface AdminCustomerRow {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  active: number;
  created_at: string;
  orders_count: number;
  returns_count: number;
  credit_balance_paise: number;
  last_activity: string | null;
}

const CUSTOMER_SORTS: Record<string, string> = {
  created_at: 'u.created_at',
  full_name: 'u.full_name',
  email: 'u.email',
  orders: 'orders_count',
  credit: 'credit_balance_paise',
  activity: 'last_activity',
};

export interface CustomerListQuery {
  search?: string;
  sort: string;
  dir: 'ASC' | 'DESC';
  limit: number;
  offset: number;
}

/** Customer accounts with live rollups. Password hashes are never selected. */
export function listCustomers(query: CustomerListQuery): { customers: AdminCustomerRow[]; total: number } {
  const filters = ["u.role = 'CUSTOMER'"];
  const params: unknown[] = [];
  if (query.search !== undefined && query.search.trim() !== '') {
    const term = `%${query.search.trim().toLowerCase()}%`;
    filters.push('(LOWER(u.email) LIKE ? OR LOWER(u.full_name) LIKE ?)');
    params.push(term, term);
  }
  const where = `WHERE ${filters.join(' AND ')}`;
  const orderBy = CUSTOMER_SORTS[query.sort] ?? CUSTOMER_SORTS.created_at;

  const total = asSingle<{ count: number }>(
    db.prepare(`SELECT COUNT(*) AS count FROM users u ${where}`).get(...params),
  )?.count ?? 0;

  const customers = asMany<AdminCustomerRow>(
    db.prepare(
      `SELECT u.id, u.email, u.full_name, p.phone, u.active, u.created_at,
              (SELECT COUNT(*) FROM orders o WHERE o.customer_id = u.id) AS orders_count,
              (SELECT COUNT(*) FROM returns r WHERE r.customer_id = u.id) AS returns_count,
              (SELECT COALESCE(SUM(amount_paise), 0) FROM store_credit_ledger l WHERE l.user_id = u.id) AS credit_balance_paise,
              (SELECT MAX(created_at) FROM (
                 SELECT created_at FROM orders WHERE customer_id = u.id
                 UNION ALL SELECT created_at FROM returns WHERE customer_id = u.id
               )) AS last_activity
         FROM users u LEFT JOIN customer_profiles p ON p.user_id = u.id
        ${where} ORDER BY ${orderBy} ${query.dir} LIMIT ? OFFSET ?`,
    ).all(...params, query.limit, query.offset),
  );
  return { customers, total };
}

export interface AdminCustomerDetail {
  user: { id: string; email: string; full_name: string; role: string; active: number; created_at: string; phone: string | null };
  orders: Array<{ id: string; order_number: string; status: string; subtotal_paise: number; created_at: string; delivered_at: string | null }>;
  returns: Array<{ id: string; return_number: string; order_id: string; status: string; resolution_type: string | null; created_at: string }>;
  refunds: Array<{ id: string; return_number: string; amount_paise: number; method: string | null; status: string }>;
  credit: {
    balancePaise: number;
    history: Array<{ id: string; type: string; amount_paise: number; reason: string | null; reference_type: string; reference_id: string; created_at: string }>;
  };
  tickets: Array<{ id: string; ticket_number: string; subject: string; status: string; updated_at: string }>;
  activity: Array<{ kind: string; status: string; description: string | null; created_at: string }>;
}

/** One customer file. Returns null for missing ids and non-customer roles. */
export function getCustomerDetail(userId: string): AdminCustomerDetail | null {
  const user = asSingle<AdminCustomerDetail['user']>(
    db.prepare(
      `SELECT u.id, u.email, u.full_name, u.role, u.active, u.created_at, p.phone
         FROM users u LEFT JOIN customer_profiles p ON p.user_id = u.id
        WHERE u.id = ? AND u.role = 'CUSTOMER'`,
    ).get(userId),
  );
  if (user === undefined) {
    return null;
  }
  return {
    user,
    orders: asMany(
      db.prepare(
        'SELECT id, order_number, status, subtotal_paise, created_at, delivered_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC',
      ).all(userId),
    ),
    returns: asMany(
      db.prepare(
        'SELECT id, return_number, order_id, status, resolution_type, created_at FROM returns WHERE customer_id = ? ORDER BY created_at DESC',
      ).all(userId),
    ),
    refunds: asMany(
      db.prepare(
        `SELECT f.id, r.return_number, f.amount_paise, f.method, f.status
           FROM refunds f JOIN returns r ON r.id = f.return_id
          WHERE r.customer_id = ? ORDER BY r.created_at DESC`,
      ).all(userId),
    ),
    credit: {
      balancePaise: asSingle<{ balance: number }>(
        db.prepare('SELECT COALESCE(SUM(amount_paise), 0) AS balance FROM store_credit_ledger WHERE user_id = ?').get(userId),
      )?.balance ?? 0,
      history: asMany(
        db.prepare(
          'SELECT id, type, amount_paise, reason, reference_type, reference_id, created_at FROM store_credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
        ).all(userId),
      ),
    },
    tickets: asMany(
      db.prepare(
        'SELECT id, ticket_number, subject, status, updated_at FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC',
      ).all(userId),
    ),
    activity: asMany(
      db.prepare(
        `SELECT kind, status, description, created_at FROM (
           SELECT 'order' AS kind, oe.status, oe.description, oe.created_at
             FROM order_events oe JOIN orders o ON o.id = oe.order_id WHERE o.customer_id = ?
           UNION ALL
           SELECT 'return' AS kind, re.status, re.description, re.created_at
             FROM return_events re JOIN returns r ON r.id = re.return_id WHERE r.customer_id = ?
         ) ORDER BY created_at DESC LIMIT 20`,
      ).all(userId, userId),
    ),
  };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface AdminOrderRow {
  id: string;
  order_number: string;
  customer_id: string;
  customer_email: string;
  customer_name: string;
  items_count: number;
  subtotal_paise: number;
  payment_status: string | null;
  status: string;
  carrier: string | null;
  tracking_number: string | null;
  created_at: string;
}

const ORDER_SORTS: Record<string, string> = {
  created_at: 'o.created_at',
  subtotal: 'o.subtotal_paise',
  order_number: 'o.order_number',
  status: 'o.status',
};

export interface OrderListQuery {
  search?: string;
  status?: string;
  customerId?: string;
  from?: string;
  to?: string;
  sort: string;
  dir: 'ASC' | 'DESC';
  limit: number;
  offset: number;
}

/** Every order, every customer. Explicit columns; address snapshots stay sealed. */
export function listOrdersAdmin(query: OrderListQuery): { orders: AdminOrderRow[]; total: number } {
  const filters: string[] = [];
  const params: unknown[] = [];
  if (query.search !== undefined && query.search.trim() !== '') {
    const term = `%${query.search.trim().toLowerCase()}%`;
    filters.push(`(LOWER(o.order_number) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(u.full_name) LIKE ?
      OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND (LOWER(oi.sku) LIKE ? OR LOWER(oi.product_name) LIKE ?)))`);
    params.push(term, term, term, term, term);
  }
  if (query.status !== undefined && query.status !== '') {
    filters.push('o.status = ?');
    params.push(query.status);
  }
  if (query.customerId !== undefined && query.customerId !== '') {
    filters.push('o.customer_id = ?');
    params.push(query.customerId);
  }
  if (query.from !== undefined && query.from !== '') {
    filters.push('o.created_at >= ?');
    params.push(query.from);
  }
  if (query.to !== undefined && query.to !== '') {
    filters.push('o.created_at <= ?');
    params.push(query.to);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const orderBy = ORDER_SORTS[query.sort] ?? ORDER_SORTS.created_at;

  const total = asSingle<{ count: number }>(
    db.prepare(`SELECT COUNT(*) AS count FROM orders o JOIN users u ON u.id = o.customer_id ${where}`).get(...params),
  )?.count ?? 0;

  const orders = asMany<AdminOrderRow>(
    db.prepare(
      `SELECT o.id, o.order_number, o.customer_id, u.email AS customer_email, u.full_name AS customer_name,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS items_count,
              o.subtotal_paise, o.payment_status, o.status, o.carrier, o.tracking_number, o.created_at
         FROM orders o JOIN users u ON u.id = o.customer_id
        ${where} ORDER BY ${orderBy} ${query.dir} LIMIT ? OFFSET ?`,
    ).all(...params, query.limit, query.offset),
  );
  return { orders, total };
}

export interface AdminOrderDetail {
  order: {
    id: string; order_number: string; customer_id: string; status: string;
    subtotal_paise: number; created_at: string; delivered_at: string | null;
    shipping_address: string | null; payment_status: string | null; payment_method: string | null;
    carrier: string | null; tracking_number: string | null; kind: string | null;
    source_return_id: string | null; credit_used_paise: number | null;
    shipping_paise: number | null; discount_paise: number | null; estimated_delivery: string | null;
  };
  customer: { id: string; email: string; full_name: string };
  items: Array<{
    id: string; product_id: string; sku: string; product_name: string; quantity: number;
    unit_price_paise: number | null; line_total_paise: number | null; product_image_url: string | null;
  }>;
  events: Array<{ id: string; status: string; description: string | null; created_at: string }>;
  returns: Array<{ id: string; return_number: string; status: string; resolution_type: string | null }>;
  refunds: Array<{ id: string; return_number: string; amount_paise: number; method: string | null; status: string }>;
  replacements: Array<{ id: string; order_number: string; kind: string | null; status: string; source_return_id: string | null }>;
}

/** One order with its linkage web. Null for unknown ids. */
export function getOrderAdmin(orderId: string): AdminOrderDetail | null {
  const order = asSingle<AdminOrderDetail['order']>(
    db.prepare(
      `SELECT id, order_number, customer_id, status, subtotal_paise, created_at, delivered_at,
              shipping_address, payment_status, payment_method, carrier, tracking_number, kind,
              source_return_id, credit_used_paise, shipping_paise, discount_paise, estimated_delivery
         FROM orders WHERE id = ?`,
    ).get(orderId),
  );
  if (order === undefined) {
    return null;
  }
  const customer = asSingle<AdminOrderDetail['customer']>(
    db.prepare('SELECT id, email, full_name FROM users WHERE id = ?').get(order.customer_id),
  ) ?? { id: order.customer_id, email: '', full_name: '' };
  return {
    order,
    customer,
    items: asMany(
      db.prepare(
        'SELECT id, product_id, sku, product_name, quantity, unit_price_paise, line_total_paise, product_image_url FROM order_items WHERE order_id = ?',
      ).all(orderId),
    ),
    events: asMany(
      db.prepare('SELECT id, status, description, created_at FROM order_events WHERE order_id = ? ORDER BY created_at ASC').all(orderId),
    ),
    returns: asMany(
      db.prepare('SELECT id, return_number, status, resolution_type FROM returns WHERE order_id = ? ORDER BY created_at ASC').all(orderId),
    ),
    refunds: asMany(
      db.prepare(
        `SELECT f.id, r.return_number, f.amount_paise, f.method, f.status
           FROM refunds f JOIN returns r ON r.id = f.return_id WHERE r.order_id = ?`,
      ).all(orderId),
    ),
    replacements: asMany(
      db.prepare(
        `SELECT id, order_number, kind, status, source_return_id FROM orders
          WHERE source_return_id IN (SELECT id FROM returns WHERE order_id = ?)`,
      ).all(orderId),
    ),
  };
}

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

export interface AdminReturnRow {
  id: string;
  return_number: string;
  order_id: string;
  order_number: string | null;
  customer_id: string;
  customer_email: string;
  customer_name: string;
  product_name: string | null;
  sku: string | null;
  quantity: number;
  reason_code: string | null;
  status: string;
  resolution_type: string | null;
  created_at: string;
}

const RETURN_SORTS: Record<string, string> = {
  created_at: 'r.created_at',
  updated_at: 'r.updated_at',
  return_number: 'r.return_number',
  status: 'r.status',
};

export interface ReturnListQuery {
  search?: string;
  status?: string;
  resolution?: string;
  customerId?: string;
  productId?: string;
  warehouseId?: string;
  from?: string;
  to?: string;
  sort: string;
  dir: 'ASC' | 'DESC';
  limit: number;
  offset: number;
}

/** Every return, every customer, every site. First-line product summary per row. */
export function listReturnsAdmin(query: ReturnListQuery): { returns: AdminReturnRow[]; total: number } {
  const filters: string[] = [];
  const params: unknown[] = [];
  if (query.search !== undefined && query.search.trim() !== '') {
    const term = `%${query.search.trim().toLowerCase()}%`;
    filters.push(`(LOWER(r.return_number) LIKE ? OR LOWER(o.order_number) LIKE ? OR LOWER(u.email) LIKE ?
      OR EXISTS (SELECT 1 FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
                 WHERE ri.return_id = r.id AND (LOWER(oi.sku) LIKE ? OR LOWER(oi.product_name) LIKE ?)))`);
    params.push(term, term, term, term, term);
  }
  if (query.status !== undefined && query.status !== '') {
    filters.push('r.status = ?');
    params.push(query.status);
  }
  if (query.resolution !== undefined && query.resolution !== '') {
    filters.push('r.resolution_type = ?');
    params.push(query.resolution);
  }
  if (query.customerId !== undefined && query.customerId !== '') {
    filters.push('r.customer_id = ?');
    params.push(query.customerId);
  }
  if (query.productId !== undefined && query.productId !== '') {
    filters.push(`EXISTS (SELECT 1 FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
      WHERE ri.return_id = r.id AND oi.product_id = ?)`);
    params.push(query.productId);
  }
  if (query.warehouseId !== undefined && query.warehouseId !== '') {
    filters.push(`EXISTS (SELECT 1 FROM receiving_records rr WHERE rr.return_id = r.id AND rr.warehouse_id = ?)`);
    params.push(query.warehouseId);
  }
  if (query.from !== undefined && query.from !== '') {
    filters.push('r.created_at >= ?');
    params.push(query.from);
  }
  if (query.to !== undefined && query.to !== '') {
    filters.push('r.created_at <= ?');
    params.push(query.to);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const orderBy = RETURN_SORTS[query.sort] ?? RETURN_SORTS.created_at;

  const total = asSingle<{ count: number }>(
    db.prepare(
      `SELECT COUNT(*) AS count FROM returns r
        LEFT JOIN orders o ON o.id = r.order_id
        JOIN users u ON u.id = r.customer_id ${where}`,
    ).get(...params),
  )?.count ?? 0;

  const returns = asMany<AdminReturnRow>(
    db.prepare(
      `SELECT r.id, r.return_number, r.order_id, o.order_number, r.customer_id,
              u.email AS customer_email, u.full_name AS customer_name,
              (SELECT oi.product_name FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
                WHERE ri.return_id = r.id LIMIT 1) AS product_name,
              (SELECT oi.sku FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
                WHERE ri.return_id = r.id LIMIT 1) AS sku,
              (SELECT COALESCE(SUM(ri.quantity), 0) FROM return_items ri WHERE ri.return_id = r.id) AS quantity,
              (SELECT ri.reason_code FROM return_items ri WHERE ri.return_id = r.id LIMIT 1) AS reason_code,
              r.status, r.resolution_type, r.created_at
         FROM returns r
         LEFT JOIN orders o ON o.id = r.order_id
         JOIN users u ON u.id = r.customer_id
        ${where} ORDER BY ${orderBy} ${query.dir} LIMIT ? OFFSET ?`,
    ).all(...params, query.limit, query.offset),
  );
  return { returns, total };
}

export interface AdminReturnDetail {
  ret: {
    id: string; return_number: string; order_id: string; customer_id: string;
    status: string; resolution_type: string | null; description: string | null;
    created_at: string; updated_at: string; cancelled_at: string | null; cancel_reason: string | null;
    approved_at?: string | null; approved_by?: string | null;
  };
  customer: { id: string; email: string; full_name: string };
  order: {
    id: string; order_number: string; status: string; subtotal_paise: number;
    created_at: string; delivered_at: string | null;
  } | null;
  items: Array<{
    id: string; order_item_id: string; product_id: string; sku: string; product_name: string;
    quantity: number; reason_code: string; reason_label: string | null; description: string | null;
  }>;
  pickup: {
    id: string; kind: string; address: string | null; date: string | null; time_window: string | null;
    carrier: string | null; tracking_number: string | null; status: string; created_at: string; updated_at: string;
  } | null;
  receiving: {
    id: string; warehouse_id: string; warehouse_code: string | null; location_id: string | null;
    received_by: string; tracking_number: string | null; carrier: string | null;
    package_condition: string; discrepancy: string; expected_quantity: number; received_quantity: number;
    notes: string | null; created_at: string;
  } | null;
  inspection: {
    id: string; warehouse_id: string; inspected_by: string; result: string | null; notes: string | null;
    started_at: string; completed_at: string | null;
    findings: Array<{
      id: string; return_item_id: string; result: string; product_condition: string;
      packaging_condition: string; quantity: number; damage_notes: string | null;
    }>;
  } | null;
  dispositions: Array<{
    id: string; return_item_id: string; warehouse_id: string; action: string; quantity: number;
    reason: string | null; notes: string | null; recovery_value_paise: number; created_at: string;
  }>;
  refund: {
    id: string; kind: string; amount_paise: number | null; method: string | null;
    status: string; initiated_at: string | null; completed_at: string | null;
  } | null;
  ledger: Array<{ id: string; type: string; amount_paise: number; reason: string | null; created_at: string }>;
  replacements: Array<{ id: string; order_number: string; kind: string | null; status: string }>;
  events: Array<{ id: string; status: string; description: string | null; created_at: string }>;
  documents: Array<{ id: string; kind: string; filename: string; mime: string; size: number; created_at: string }>;
  audit: Array<{
    id: string; actor_id: string | null; actor_role: string; warehouse_id: string | null;
    action: string; previous_state: string | null; new_state: string | null; created_at: string;
  }>;
}

/** The complete lifecycle file. Null for unknown ids. Storage paths stay sealed. */
export function getReturnAdmin(returnId: string): AdminReturnDetail | null {
  const ret = asSingle<AdminReturnDetail['ret']>(
    db.prepare(
      `SELECT id, return_number, order_id, customer_id, status, resolution_type, description,
              created_at, updated_at, cancelled_at, cancel_reason, approved_at, approved_by
         FROM returns WHERE id = ?`,
    ).get(returnId),
  );
  if (ret === undefined) {
    return null;
  }
  const customer = asSingle<AdminReturnDetail['customer']>(
    db.prepare('SELECT id, email, full_name FROM users WHERE id = ?').get(ret.customer_id),
  ) ?? { id: ret.customer_id, email: '', full_name: '' };
  const order = asSingle<AdminReturnDetail['order']>(
    db.prepare(
      'SELECT id, order_number, status, subtotal_paise, created_at, delivered_at FROM orders WHERE id = ?',
    ).get(ret.order_id),
  ) ?? null;
  const inspectionRow = asSingle<{ id: string; warehouse_id: string; inspected_by: string; result: string | null; notes: string | null; started_at: string; completed_at: string | null }>(
    db.prepare('SELECT * FROM inspections WHERE return_id = ?').get(returnId),
  );
  return {
    ret,
    customer,
    order,
    items: asMany(
      db.prepare(
        `SELECT ri.id, ri.order_item_id, oi.product_id, oi.sku, oi.product_name, ri.quantity,
                ri.reason_code, rr.label AS reason_label, ri.description
           FROM return_items ri
           JOIN order_items oi ON oi.id = ri.order_item_id
           LEFT JOIN return_reasons rr ON rr.code = ri.reason_code
          WHERE ri.return_id = ? ORDER BY oi.product_name ASC`,
      ).all(returnId),
    ),
    pickup: asSingle(
      db.prepare(
        'SELECT id, kind, address, date, time_window, carrier, tracking_number, status, created_at, updated_at FROM pickups WHERE return_id = ?',
      ).get(returnId),
    ) ?? null,
    receiving: asSingle(
      db.prepare(
        `SELECT rec.id, rec.warehouse_id, w.code AS warehouse_code, rec.location_id, rec.received_by,
                rec.tracking_number, rec.carrier, rec.package_condition, rec.discrepancy,
                rec.expected_quantity, rec.received_quantity, rec.notes, rec.created_at
           FROM receiving_records rec LEFT JOIN warehouses w ON w.id = rec.warehouse_id
          WHERE rec.return_id = ?`,
      ).get(returnId),
    ) ?? null,
    inspection: inspectionRow === undefined
      ? null
      : {
        ...inspectionRow,
        findings: asMany(
          db.prepare(
            'SELECT id, return_item_id, result, product_condition, packaging_condition, quantity, damage_notes FROM inspection_items WHERE inspection_id = ?',
          ).all(inspectionRow.id),
        ),
      },
    dispositions: asMany(
      db.prepare(
        'SELECT id, return_item_id, warehouse_id, action, quantity, reason, notes, recovery_value_paise, created_at FROM dispositions WHERE return_id = ? ORDER BY created_at ASC',
      ).all(returnId),
    ),
    refund: asSingle(
      db.prepare(
        'SELECT id, kind, amount_paise, method, status, initiated_at, completed_at FROM refunds WHERE return_id = ?',
      ).get(returnId),
    ) ?? null,
    ledger: asMany(
      db.prepare(
        "SELECT id, type, amount_paise, reason, created_at FROM store_credit_ledger WHERE reference_type = 'RETURN' AND reference_id = ? ORDER BY created_at ASC",
      ).all(returnId),
    ),
    replacements: asMany(
      db.prepare('SELECT id, order_number, kind, status FROM orders WHERE source_return_id = ?').all(returnId),
    ),
    events: asMany(
      db.prepare('SELECT id, status, description, created_at FROM return_events WHERE return_id = ? ORDER BY created_at ASC').all(returnId),
    ),
    documents: asMany(
      db.prepare('SELECT id, kind, filename, mime, size, created_at FROM documents WHERE return_id = ? ORDER BY created_at DESC').all(returnId),
    ),
    audit: asMany(
      db.prepare(
        "SELECT id, actor_id, actor_role, warehouse_id, action, previous_state, new_state, created_at FROM audit_log WHERE entity_id = ? ORDER BY created_at ASC",
      ).all(returnId),
    ),
  };
}

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

export interface AdminWarehouseRow {
  id: string;
  code: string;
  name: string;
  city: string;
  active: number;
  operators: number;
  open_tasks: number;
  pending_returns: number;
  inventory_units: number;
  resolved_30d: number;
}

/** Every site with a live workload rollup. No per-site secret state exists. */
export function listWarehousesAdmin(): { warehouses: AdminWarehouseRow[] } {
  const month = sinceIso(30);
  const warehouses = asMany<AdminWarehouseRow>(
    db.prepare(
      `SELECT w.id, w.code, w.name, w.city, w.active,
              (SELECT COUNT(*) FROM users u WHERE u.warehouse_id = w.id AND u.role = 'WAREHOUSE') AS operators,
              (SELECT COUNT(*) FROM warehouse_tasks t WHERE t.warehouse_id = w.id AND t.status IN ('TODO', 'IN_PROGRESS')) AS open_tasks,
              (SELECT COUNT(DISTINCT r.id) FROM returns r
                 JOIN receiving_records rec ON rec.return_id = r.id
                WHERE rec.warehouse_id = w.id AND r.status IN ('RECEIVED', 'INSPECTION')) AS pending_returns,
              (SELECT COALESCE(SUM(quantity), 0) FROM inventory_buckets b WHERE b.warehouse_id = w.id) AS inventory_units,
              (SELECT COUNT(*) FROM warehouse_tasks t WHERE t.warehouse_id = w.id AND t.status = 'COMPLETED' AND t.completed_at >= ?) AS resolved_30d
         FROM warehouses w ORDER BY w.code ASC`,
    ).all(month),
  );
  return { warehouses };
}

export interface AdminWarehouseUserRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  warehouse_id: string | null;
  warehouse_code: string | null;
  active: number;
  created_at: string;
}

export interface WarehouseUserListQuery {
  search?: string;
  warehouseId?: string;
  limit: number;
  offset: number;
}

/** Operator accounts. Explicit safe columns — password hashes never selected. */
export function listWarehouseUsers(query: WarehouseUserListQuery): { users: AdminWarehouseUserRow[]; total: number } {
  const filters = ["u.role = 'WAREHOUSE'"];
  const params: unknown[] = [];
  if (query.search !== undefined && query.search.trim() !== '') {
    const term = `%${query.search.trim().toLowerCase()}%`;
    filters.push('(LOWER(u.email) LIKE ? OR LOWER(u.full_name) LIKE ?)');
    params.push(term, term);
  }
  if (query.warehouseId !== undefined && query.warehouseId !== '') {
    filters.push('u.warehouse_id = ?');
    params.push(query.warehouseId);
  }
  const where = `WHERE ${filters.join(' AND ')}`;
  const total = asSingle<{ count: number }>(
    db.prepare(`SELECT COUNT(*) AS count FROM users u ${where}`).get(...params),
  )?.count ?? 0;
  const users = asMany<AdminWarehouseUserRow>(
    db.prepare(
      `SELECT u.id, u.email, u.full_name, u.role, u.warehouse_id, w.code AS warehouse_code, u.active, u.created_at
         FROM users u LEFT JOIN warehouses w ON w.id = u.warehouse_id
        ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    ).all(...params, query.limit, query.offset),
  );
  return { users, total };
}

export interface WorkloadQuery {
  warehouseId?: string;
  status?: string;
  priority?: string;
  assignedTo?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface WorkloadReturn {
  id: string;
  return_number: string;
  status: string;
  warehouse_id: string | null;
  created_at: string;
}

export interface WorkloadTask {
  id: string;
  title: string;
  kind: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  due_at: string;
  warehouse_id: string;
}

export interface WorkloadView {
  returns: WorkloadReturn[];
  returnsTotal: number;
  tasks: WorkloadTask[];
  tasksTotal: number;
}

/** Floor workload across sites, filterable. Non-terminal returns by default. */
export function warehouseWorkload(query: WorkloadQuery): WorkloadView {
  const rFilters: string[] = [];
  const rParams: unknown[] = [];
  if (query.warehouseId !== undefined && query.warehouseId !== '') {
    rFilters.push(`EXISTS (SELECT 1 FROM receiving_records rr WHERE rr.return_id = r.id AND rr.warehouse_id = ?)`);
    rParams.push(query.warehouseId);
  }
  if (query.status !== undefined && query.status !== '' && query.status !== 'ALL') {
    rFilters.push('r.status = ?');
    rParams.push(query.status);
  } else {
    rFilters.push(`r.status NOT IN ('RESOLVED', 'CANCELLED', 'REJECTED')`);
  }
  if (query.from !== undefined && query.from !== '') {
    rFilters.push('r.created_at >= ?');
    rParams.push(query.from);
  }
  if (query.to !== undefined && query.to !== '') {
    rFilters.push('r.created_at <= ?');
    rParams.push(query.to);
  }
  const rWhere = `WHERE ${rFilters.join(' AND ')}`;
  const returnsTotal = asSingle<{ count: number }>(
    db.prepare(`SELECT COUNT(*) AS count FROM returns r ${rWhere}`).get(...rParams),
  )?.count ?? 0;
  const returns = asMany<WorkloadReturn>(
    db.prepare(
      `SELECT r.id, r.return_number, r.status,
              (SELECT rr.warehouse_id FROM receiving_records rr WHERE rr.return_id = r.id) AS warehouse_id,
              r.created_at
         FROM returns r ${rWhere} ORDER BY r.created_at ASC LIMIT ? OFFSET ?`,
    ).all(...rParams, query.limit, query.offset),
  );

  const tFilters = ['1 = 1'];
  const tParams: unknown[] = [];
  if (query.warehouseId !== undefined && query.warehouseId !== '') {
    tFilters.push('t.warehouse_id = ?');
    tParams.push(query.warehouseId);
  }
  if (query.status !== undefined && query.status !== '' && query.status !== 'ALL') {
    tFilters.push('t.status = ?');
    tParams.push(query.status);
  }
  if (query.priority !== undefined && query.priority !== '') {
    tFilters.push('t.priority = ?');
    tParams.push(query.priority);
  }
  if (query.assignedTo !== undefined && query.assignedTo !== '') {
    tFilters.push('t.assigned_to = ?');
    tParams.push(query.assignedTo);
  }
  if (query.from !== undefined && query.from !== '') {
    tFilters.push('t.created_at >= ?');
    tParams.push(query.from);
  }
  if (query.to !== undefined && query.to !== '') {
    tFilters.push('t.created_at <= ?');
    tParams.push(query.to);
  }
  const tWhere = `WHERE ${tFilters.join(' AND ')}`;
  const tasksTotal = asSingle<{ count: number }>(
    db.prepare(`SELECT COUNT(*) AS count FROM warehouse_tasks t ${tWhere}`).get(...tParams),
  )?.count ?? 0;
  const tasks = asMany<WorkloadTask>(
    db.prepare(
      `SELECT t.id, t.title, t.kind, t.status, t.priority, t.assigned_to, t.due_at, t.warehouse_id
         FROM warehouse_tasks t ${tWhere} ORDER BY t.due_at ASC LIMIT ? OFFSET ?`,
    ).all(...tParams, query.limit, query.offset),
  );
  return { returns, returnsTotal, tasks, tasksTotal };
}

// ---------------------------------------------------------------------------
// Inventory (global)
// ---------------------------------------------------------------------------

export interface AdminInventoryRow {
  product_id: string;
  sku: string;
  name: string;
  image_url: string | null;
  sellable_stock: number;
  buckets: Array<{ warehouse_id: string; warehouse_code: string | null; state: string; quantity: number }>;
}

export interface InventoryListQuery {
  search?: string;
  limit: number;
  offset: number;
}

/** Global stock: catalogue sellable plus every site's buckets. */
export function listInventoryAdmin(query: InventoryListQuery): { inventory: AdminInventoryRow[]; total: number } {
  const filters: string[] = [];
  const params: unknown[] = [];
  if (query.search !== undefined && query.search.trim() !== '') {
    const term = `%${query.search.trim().toLowerCase()}%`;
    filters.push('(LOWER(p.sku) LIKE ? OR LOWER(p.name) LIKE ?)');
    params.push(term, term);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const total = asSingle<{ count: number }>(
    db.prepare(`SELECT COUNT(*) AS count FROM products p ${where}`).get(...params),
  )?.count ?? 0;
  const products = asMany<{ id: string; sku: string; name: string; image_url: string; stock: number }>(
    db.prepare(`SELECT id, sku, name, image_url, stock FROM products p ${where} ORDER BY name ASC LIMIT ? OFFSET ?`).all(
      ...params, query.limit, query.offset,
    ),
  );
  const ids = products.map((product) => product.id);
  const buckets = ids.length === 0
    ? []
    : asMany<{ product_id: string; warehouse_id: string; warehouse_code: string | null; state: string; quantity: number }>(
      db.prepare(
        `SELECT b.product_id, b.warehouse_id, w.code AS warehouse_code, b.state, b.quantity
           FROM inventory_buckets b LEFT JOIN warehouses w ON w.id = b.warehouse_id
          WHERE b.product_id IN (${ids.map(() => '?').join(', ')}) ORDER BY b.state ASC`,
      ).all(...ids),
    );
  const inventory = products.map((product) => ({
    product_id: product.id,
    sku: product.sku,
    name: product.name,
    image_url: product.image_url === '' ? null : product.image_url,
    sellable_stock: product.stock,
    buckets: buckets.filter((bucket) => bucket.product_id === product.id),
  }));
  return { inventory, total };
}

export interface AdminMovementRow {
  id: string;
  warehouse_id: string;
  warehouse_code: string | null;
  product_id: string;
  sku: string;
  quantity: number;
  from_state: string | null;
  to_state: string | null;
  reason: string;
  reference_type: string;
  reference_id: string;
  operator_id: string | null;
  created_at: string;
}

export interface MovementListQuery {
  warehouseId?: string;
  productId?: string;
  reason?: string;
  limit: number;
  offset: number;
}

/** Global movement history. Same rows the warehouse screens read. */
export function listMovementsAdmin(query: MovementListQuery): {
  movements: AdminMovementRow[];
  total: number;
} {
  const filters: string[] = [];
  const params: unknown[] = [];
  if (query.warehouseId !== undefined && query.warehouseId !== '') {
    filters.push('m.warehouse_id = ?');
    params.push(query.warehouseId);
  }
  if (query.productId !== undefined && query.productId !== '') {
    filters.push('m.product_id = ?');
    params.push(query.productId);
  }
  if (query.reason !== undefined && query.reason !== '') {
    filters.push('m.reason = ?');
    params.push(query.reason);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const total = asSingle<{ count: number }>(
    db.prepare(`SELECT COUNT(*) AS count FROM inventory_movements m ${where}`).get(...params),
  )?.count ?? 0;
  const movements = asMany<AdminMovementRow>(
    db.prepare(
      `SELECT m.id, m.warehouse_id, w.code AS warehouse_code, m.product_id, m.sku, m.quantity,
              m.from_state, m.to_state, m.reason, m.reference_type, m.reference_id, m.operator_id, m.created_at
         FROM inventory_movements m LEFT JOIN warehouses w ON w.id = m.warehouse_id
        ${where} ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`,
    ).all(...params, query.limit, query.offset),
  );
  return { movements, total };
}

// ---------------------------------------------------------------------------
// Analytics (global, exact aggregates — never means of per-site means)
// ---------------------------------------------------------------------------

export interface AdminAnalytics {
  scope: 'global' | 'warehouse';
  warehouseId: string | null;
  windowDays: number;
  commerce: { orders: number; revenuePaise: number; averageOrderPaise: number | null; byStatus: Array<{ status: string; count: number }> };
  returns: {
    volume: number; rate: number | null;
    byReason: Array<{ reason: string; count: number }>;
    byResolution: Array<{ resolution: string | null; count: number }>;
    averageReceiveToResolutionHours: number | null;
  };
  refunds: { count: number; amountPaise: number; pending: number };
  credit: { issuedPaise: number; usedPaise: number; outstandingPaise: number };
  inventory: { available: number; returned: number; damaged: number; restockedUnits: number; movements: number };
  warehouse: {
    averageReceiveToInspectionHours: number | null;
    averageInspectionMinutes: number | null;
    pendingWorkload: number;
    overdueTasks: number;
  };
  recovery: {
    valuePaise: number;
    byAction: Array<{ action: string; count: number; quantity: number }>;
  };
  customers: { newCustomers: number; activeCustomers: number; ordersPerCustomer: number | null; returnsActive: number };
  warnings: Array<{ action: string; count: number }>;
  byWarehouse: Array<{ warehouseId: string; code: string; returns: number; tasks: number; inventoryUnits: number }>;
}

function avgRounded(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (finite.length === 0) return null;
  return Math.round((finite.reduce((sum, value) => sum + value, 0) / finite.length) * 10) / 10;
}

/**
 * Global analytics, or a single site delegated to the existing warehouse
 * engine. Global figures aggregate rows directly, so cycle-time means stay
 * exact no matter how many sites exist.
 */
export function adminAnalytics(windowDays: number, warehouseId?: string): AdminAnalytics {
  if (warehouseId !== undefined && warehouseId !== '') {
    const site = warehouseAnalytics(warehouseId, windowDays);
    return {
      scope: 'warehouse',
      warehouseId,
      windowDays,
      commerce: { orders: 0, revenuePaise: 0, averageOrderPaise: null, byStatus: [] },
      returns: { volume: 0, rate: null, byReason: [], byResolution: [], averageReceiveToResolutionHours: site.averageReceiveToResolutionHours },
      refunds: { count: 0, amountPaise: 0, pending: 0 },
      credit: { issuedPaise: 0, usedPaise: 0, outstandingPaise: 0 },
      inventory: {
        available: 0, returned: 0, damaged: site.damagedUnits, restockedUnits: site.restockedUnits,
        movements: site.movementsByReason.reduce((sum, row) => sum + row.count, 0),
      },
      warehouse: {
        averageReceiveToInspectionHours: site.averageReceiveToInspectionHours,
        averageInspectionMinutes: site.averageInspectionMinutes,
        pendingWorkload: site.pendingInspection + site.pendingDisposition,
        overdueTasks: site.overdueTasks,
      },
      recovery: {
        valuePaise: site.recoveryValuePaise,
        byAction: site.dispositionsByAction.map((row) => ({ action: row.action, count: row.count, quantity: row.quantity })),
      },
      customers: { newCustomers: 0, activeCustomers: 0, ordersPerCustomer: null, returnsActive: 0 },
      warnings: site.warnings,
      byWarehouse: [],
    };
  }

  const since = sinceIso(windowDays);
  const monthAgo = sinceIso(30);

  const orderAgg = asSingle<{ orders: number; revenue: number }>(
    db.prepare(
      'SELECT COUNT(*) AS orders, COALESCE(SUM(subtotal_paise), 0) AS revenue FROM orders WHERE created_at >= ?',
    ).get(since),
  ) ?? { orders: 0, revenue: 0 };

  const returnsVolume = asSingle<{ count: number }>(
    db.prepare('SELECT COUNT(*) AS count FROM returns WHERE created_at >= ?').get(since),
  )?.count ?? 0;

  const resolutionHours = asMany<{ hours: number | null }>(
    db.prepare(
      `SELECT (julianday(r.updated_at) - julianday(rec.created_at)) * 24.0 AS hours
         FROM returns r JOIN receiving_records rec ON rec.return_id = r.id
        WHERE r.status = 'RESOLVED' AND r.updated_at >= ?`,
    ).all(since),
  ).map((row) => row.hours);

  const receiveToInspection = asMany<{ hours: number | null }>(
    db.prepare(
      `SELECT (julianday(i.started_at) - julianday(rec.created_at)) * 24.0 AS hours
         FROM inspections i JOIN receiving_records rec ON rec.return_id = i.return_id
        WHERE i.started_at >= ?`,
    ).all(since),
  ).map((row) => row.hours);

  const inspectionMinutes = asMany<{ hours: number | null }>(
    db.prepare(
      `SELECT (julianday(completed_at) - julianday(started_at)) * 1440.0 AS hours
         FROM inspections WHERE completed_at IS NOT NULL AND completed_at >= ?`,
    ).all(since),
  ).map((row) => row.hours);

  const sites = asMany<{ id: string; code: string }>(db.prepare('SELECT id, code FROM warehouses ORDER BY code ASC').all());
  const distinctCustomers = asSingle<{ count: number }>(
    db.prepare('SELECT COUNT(DISTINCT customer_id) AS count FROM orders WHERE created_at >= ?').get(since),
  )?.count ?? 0;

  return {
    scope: 'global',
    warehouseId: null,
    windowDays,
    commerce: {
      orders: orderAgg.orders,
      revenuePaise: orderAgg.revenue,
      averageOrderPaise: orderAgg.orders === 0 ? null : Math.round(orderAgg.revenue / orderAgg.orders),
      byStatus: asMany<{ status: string; count: number }>(
        db.prepare('SELECT status, COUNT(*) AS count FROM orders WHERE created_at >= ? GROUP BY status ORDER BY count DESC').all(since),
      ),
    },
    returns: {
      volume: returnsVolume,
      rate: orderAgg.orders === 0 ? null : Math.round((returnsVolume / orderAgg.orders) * 1000) / 1000,
      byReason: asMany<{ reason: string; count: number }>(
        db.prepare(
          `SELECT ri.reason_code AS reason, COUNT(*) AS count FROM return_items ri
            JOIN returns r ON r.id = ri.return_id WHERE r.created_at >= ? GROUP BY reason ORDER BY count DESC`,
        ).all(since),
      ),
      byResolution: asMany<{ resolution: string | null; count: number }>(
        db.prepare(
          'SELECT resolution_type AS resolution, COUNT(*) AS count FROM returns WHERE created_at >= ? GROUP BY resolution ORDER BY count DESC',
        ).all(since),
      ),
      averageReceiveToResolutionHours: avgRounded(resolutionHours),
    },
    refunds: {
      count: asSingle<{ count: number }>(
        db.prepare("SELECT COUNT(*) AS count FROM refunds WHERE status = 'COMPLETED' AND completed_at >= ?").get(since),
      )?.count ?? 0,
      amountPaise: asSingle<{ total: number }>(
        db.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS total FROM refunds WHERE status = 'COMPLETED' AND completed_at >= ?").get(since),
      )?.total ?? 0,
      pending: count('refunds', "status = 'PENDING'"),
    },
    credit: {
      issuedPaise: asSingle<{ total: number }>(
        db.prepare("SELECT COALESCE(SUM(amount_paise), 0) AS total FROM store_credit_ledger WHERE type = 'CREDIT' AND created_at >= ?").get(since),
      )?.total ?? 0,
      usedPaise: asSingle<{ total: number }>(
        db.prepare("SELECT COALESCE(SUM(-amount_paise), 0) AS total FROM store_credit_ledger WHERE type = 'DEBIT' AND created_at >= ?").get(since),
      )?.total ?? 0,
      outstandingPaise: asSingle<{ total: number }>(
        db.prepare('SELECT COALESCE(SUM(amount_paise), 0) AS total FROM store_credit_ledger').get(),
      )?.total ?? 0,
    },
    inventory: {
      available: asSingle<{ quantity: number }>(
        db.prepare("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM inventory_buckets WHERE state = 'AVAILABLE'").get(),
      )?.quantity ?? 0,
      returned: asSingle<{ quantity: number }>(
        db.prepare("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM inventory_buckets WHERE state = 'RETURNED'").get(),
      )?.quantity ?? 0,
      damaged: asSingle<{ quantity: number }>(
        db.prepare("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM inventory_buckets WHERE state = 'DAMAGED'").get(),
      )?.quantity ?? 0,
      restockedUnits: asSingle<{ quantity: number }>(
        db.prepare("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM inventory_movements WHERE reason = 'RESTOCK' AND created_at >= ?").get(since),
      )?.quantity ?? 0,
      movements: count('inventory_movements', 'created_at >= ?', since),
    },
    warehouse: {
      averageReceiveToInspectionHours: avgRounded(receiveToInspection),
      averageInspectionMinutes: avgRounded(inspectionMinutes),
      pendingWorkload: count('returns', "status IN ('RECEIVED', 'INSPECTION')"),
      overdueTasks: count('warehouse_tasks', "status IN ('TODO', 'IN_PROGRESS') AND due_at < ?", new Date().toISOString()),
    },
    recovery: {
      valuePaise: asSingle<{ total: number }>(
        db.prepare('SELECT COALESCE(SUM(recovery_value_paise), 0) AS total FROM dispositions WHERE created_at >= ?').get(since),
      )?.total ?? 0,
      byAction: asMany<{ action: string; count: number; quantity: number }>(
        db.prepare(
          'SELECT action, COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS quantity FROM dispositions WHERE created_at >= ? GROUP BY action ORDER BY count DESC',
        ).all(since),
      ),
    },
    customers: {
      newCustomers: count('users', "role = 'CUSTOMER' AND created_at >= ?", since),
      activeCustomers: asSingle<{ count: number }>(
        db.prepare('SELECT COUNT(DISTINCT customer_id) AS count FROM orders WHERE created_at >= ?').get(since),
      )?.count ?? 0,
      ordersPerCustomer: distinctCustomers === 0 || orderAgg.orders === 0
        ? null
        : Math.round((orderAgg.orders / distinctCustomers) * 100) / 100,
      returnsActive: count('returns', `status NOT IN ('RESOLVED', 'CANCELLED', 'REJECTED') AND created_at >= ?`, since),
    },
    warnings: asMany<{ action: string; count: number }>(
      db.prepare(
        "SELECT action, COUNT(*) AS count FROM audit_log WHERE action LIKE 'WARNING_%' AND created_at >= ? GROUP BY action ORDER BY count DESC",
      ).all(since),
    ),
    byWarehouse: sites.map((site) => ({
      warehouseId: site.id,
      code: site.code,
      returns: count('returns', 'id IN (SELECT return_id FROM receiving_records WHERE warehouse_id = ?) AND created_at >= ?', site.id, since),
      tasks: count('warehouse_tasks', 'warehouse_id = ? AND created_at >= ?', site.id, since),
      inventoryUnits: asSingle<{ quantity: number }>(
        db.prepare('SELECT COALESCE(SUM(quantity), 0) AS quantity FROM inventory_buckets WHERE warehouse_id = ?').get(site.id),
      )?.quantity ?? 0,
    })),
  };
}
