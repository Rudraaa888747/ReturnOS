import crypto from 'node:crypto';
import { getChangedMindRefundDays, getReturnWindowDays, getShippingPolicy } from './admin/settings.js';
import { consumeAvailableStock } from './warehouse/inventory.js';
import { recordAudit } from './warehouse/audit.js';
import { DEFAULT_WAREHOUSE_ID } from './warehouse/schema.js';
import { db } from './db.js';
import { HttpError } from './middleware/error.js';
import { id, nowIso } from './utils.js';
import type { PickupKind, ResolutionType, ReturnCreateInput } from './validation.js';

// ---------------------------------------------------------------------------
// Row types matching the database tables.
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: string;
  active: number;
  created_at: string;
}

export interface ProfileRow {
  user_id: string;
  phone: string | null;
  comm_prefs: string;
  notif_prefs: string;
}

export interface AddressRow {
  id: string;
  user_id: string;
  label: string | null;
  full_name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  phone: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface OrderRow {
  id: string;
  order_number: string;
  customer_id: string;
  status: string;
  /** Legacy REAL rupee column. Kept in sync; `subtotal_paise` is authoritative. */
  subtotal: number;
  subtotal_paise?: number | null;
  created_at: string;
  delivered_at: string | null;
  shipping_address?: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  carrier?: string | null;
  tracking_number?: string | null;
  kind?: string | null;
  source_return_id?: string | null;
  credit_used_paise?: number | null;
  shipping_paise?: number | null;
  discount_paise?: number | null;
  estimated_delivery?: string | null;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  quantity: number;
  /** Legacy REAL rupee columns. Kept in sync; the paise columns are authoritative. */
  unit_price: number;
  line_total: number;
  unit_price_paise?: number | null;
  line_total_paise?: number | null;
  product_image_url?: string | null;
}

export interface ReasonRow {
  code: string;
  label: string;
  description: string | null;
  active: number;
  sort_order?: number | null;
}

export interface ReturnRow {
  id: string;
  return_number: string;
  order_id: string;
  customer_id: string;
  status: string;
  resolution_type: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  /** Set when the claim was accepted. Required before any financial outcome. */
  approved_at?: string | null;
  approved_by?: string | null;
}

export interface ReturnItemRow {
  id: string;
  return_id: string;
  order_item_id: string;
  quantity: number;
  reason_code: string;
  description: string | null;
}

export interface ReturnEventRow {
  id: string;
  return_id: string;
  status: string;
  description: string | null;
  created_at: string;
}

export interface PickupRow {
  id: string;
  return_id: string;
  kind: string;
  address: string | null;
  date: string | null;
  time_window: string | null;
  carrier: string | null;
  tracking_number: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface RefundRow {
  id: string;
  return_id: string;
  kind: string;
  /** Legacy REAL rupee column. Kept in sync; `amount_paise` is authoritative. */
  amount: number | null;
  amount_paise?: number | null;
  method: string | null;
  status: string;
  initiated_at: string | null;
  completed_at: string | null;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  return_id: string | null;
  type: string;
  title: string;
  body: string;
  is_read: number;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  return_id: string;
  user_id: string;
  kind: string;
  filename: string;
  mime: string;
  size: number;
  storage_path: string;
  created_at: string;
}

export interface TicketRow {
  id: string;
  ticket_number: string;
  user_id: string;
  return_id: string | null;
  subject: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TicketMessageRow {
  id: string;
  ticket_id: string;
  author_role: string;
  body: string;
  created_at: string;
}

export interface FeedbackRow {
  id: string;
  return_id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface EligibleOrderItem extends OrderItemRow {
  remaining_quantity: number;
  eligible: boolean;
  /** Why this line cannot be returned, when it cannot. Customer-facing copy. */
  ineligibleReason: string | null;
}

export interface OrderDetail {
  order: OrderRow;
  items: EligibleOrderItem[];
  eligible: boolean;
  /** End of the return window, ISO. Null until the order is delivered. */
  eligibleUntil: string | null;
  /** Why no return can be started on this order, when none can. */
  ineligibleReason: string | null;
  /** Resolutions the backend will accept, keyed by reason code. */
  resolutionsByReason: Record<string, ResolutionType[]>;
}

export interface ReturnDetail {
  ret: ReturnRow;
  items: ReturnItemRow[];
  events: ReturnEventRow[];
  pickup: PickupRow | null;
  refund: RefundRow | null;
  order: OrderRow | null;
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

function asSingle<T>(value: unknown): T | undefined {
  return value as T | undefined;
}

function asMany<T>(value: unknown): T[] {
  return value as T[];
}

/** End of the return window for a delivery, as an ISO timestamp. */
function returnWindowEndIso(deliveredAt: string): string {
  const end = new Date(deliveredAt);
  end.setDate(end.getDate() + getReturnWindowDays());
  return end.toISOString();
}

function daysSince(isoDate: string, now: Date): number {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) {
    return Number.POSITIVE_INFINITY;
  }
  return (now.getTime() - then) / 86_400_000;
}

// ---------------------------------------------------------------------------
// Users and authentication.
// ---------------------------------------------------------------------------

export function createUser(input: { email: string; passwordHash: string; fullName: string; role?: string }): UserRow {
  const now = nowIso();
  const row: UserRow = {
    id: id(),
    email: input.email.toLowerCase().trim(),
    password_hash: input.passwordHash,
    full_name: input.fullName.trim(),
    role: input.role ?? 'CUSTOMER',
    active: 1,
    created_at: now,
  };
  db.prepare(
    'INSERT INTO users (id, email, password_hash, full_name, role, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
  ).run(row.id, row.email, row.password_hash, row.full_name, row.role, row.created_at);
  db.prepare(
    'INSERT OR IGNORE INTO customer_profiles (user_id, phone, comm_prefs, notif_prefs) VALUES (?, NULL, ?, ?)',
  ).run(row.id, '{}', '{}');
  return row;
}

export function findUserByEmail(email: string): UserRow | undefined {
  return asSingle<UserRow>(
    db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim()),
  );
}

export function findUserById(userId: string): UserRow | undefined {
  return asSingle<UserRow>(db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
}

export function countUsers(): number {
  const row = asSingle<{ count: number }>(db.prepare('SELECT COUNT(*) AS count FROM users').get());
  return row?.count ?? 0;
}

export function updateUserFullName(userId: string, fullName: string): void {
  db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(fullName.trim(), userId);
}

export function updateUserPassword(userId: string, passwordHash: string): void {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

export function createPasswordReset(userId: string, tokenHash: string, expiresAt: string): string {
  const resetId = id();
  db.prepare(
    'INSERT INTO password_resets (id, user_id, token_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
  ).run(resetId, userId, tokenHash, expiresAt, nowIso());
  return resetId;
}

/** Consume a password-reset token. Returns the user id, or null when invalid. */
export function consumePasswordReset(tokenHash: string): string | null {
  const now = nowIso();
  const row = asSingle<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
    db.prepare('SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?').get(tokenHash),
  );
  if (row === undefined || row.used_at !== null || row.expires_at <= now) {
    return null;
  }
  db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(now, row.id);
  return row.user_id;
}

// ---------------------------------------------------------------------------
// Customer profiles.
// ---------------------------------------------------------------------------

export function getProfile(userId: string): ProfileRow {
  db.prepare(
    'INSERT OR IGNORE INTO customer_profiles (user_id, phone, comm_prefs, notif_prefs) VALUES (?, NULL, ?, ?)',
  ).run(userId, '{}', '{}');
  const row = asSingle<ProfileRow>(db.prepare('SELECT * FROM customer_profiles WHERE user_id = ?').get(userId));
  if (row === undefined) {
    throw new HttpError(500, 'PROFILE_ERROR', 'Customer profile could not be loaded');
  }
  return row;
}

export function upsertProfile(
  userId: string,
  patch: { phone?: string; commPrefs?: Record<string, boolean>; notifPrefs?: Record<string, boolean> },
): ProfileRow {
  const current = getProfile(userId);
  const phone = patch.phone !== undefined ? patch.phone : current.phone;
  const commPrefs = patch.commPrefs !== undefined ? JSON.stringify(patch.commPrefs) : current.comm_prefs;
  const notifPrefs = patch.notifPrefs !== undefined ? JSON.stringify(patch.notifPrefs) : current.notif_prefs;
  db.prepare('UPDATE customer_profiles SET phone = ?, comm_prefs = ?, notif_prefs = ? WHERE user_id = ?').run(
    phone,
    commPrefs,
    notifPrefs,
    userId,
  );
  return getProfile(userId);
}

// ---------------------------------------------------------------------------
// Addresses with default-address rules.
// ---------------------------------------------------------------------------

export function listAddresses(userId: string): AddressRow[] {
  return asMany<AddressRow>(
    db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at ASC').all(userId),
  );
}

export function getAddress(userId: string, addressId: string): AddressRow | undefined {
  return asSingle<AddressRow>(
    db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(addressId, userId),
  );
}

export interface AddressInput {
  label?: string;
  fullName: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
  phone?: string;
  isDefault?: boolean;
}

export const createAddress = db.transaction((userId: string, input: AddressInput): AddressRow => {
  const existing = asSingle<{ count: number }>(
    db.prepare('SELECT COUNT(*) AS count FROM addresses WHERE user_id = ?').get(userId),
  );
  const makeDefault = input.isDefault === true || (existing?.count ?? 0) === 0;
  if (makeDefault) {
    db.prepare('UPDATE addresses SET is_default = 0, updated_at = ? WHERE user_id = ?').run(nowIso(), userId);
  }
  const now = nowIso();
  const row: AddressRow = {
    id: id(),
    user_id: userId,
    label: input.label ?? null,
    full_name: input.fullName,
    line1: input.line1,
    line2: input.line2 ?? null,
    city: input.city,
    state: input.state,
    postal_code: input.postalCode,
    country: input.country ?? 'IN',
    phone: input.phone ?? null,
    is_default: makeDefault ? 1 : 0,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO addresses (id, user_id, label, full_name, line1, line2, city, state, postal_code, country, phone, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id, row.user_id, row.label, row.full_name, row.line1, row.line2, row.city, row.state,
    row.postal_code, row.country, row.phone, row.is_default, row.created_at, row.updated_at,
  );
  return row;
});

export const updateAddress = db.transaction(
  (userId: string, addressId: string, input: Partial<AddressInput>): AddressRow => {
    const current = getAddress(userId, addressId);
    if (current === undefined) {
      throw new HttpError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
    }
    if (input.isDefault === true) {
      db.prepare('UPDATE addresses SET is_default = 0, updated_at = ? WHERE user_id = ?').run(nowIso(), userId);
    }
    const updated: AddressRow = {
      ...current,
      label: input.label ?? current.label,
      full_name: input.fullName ?? current.full_name,
      line1: input.line1 ?? current.line1,
      line2: input.line2 ?? current.line2,
      city: input.city ?? current.city,
      state: input.state ?? current.state,
      postal_code: input.postalCode ?? current.postal_code,
      country: input.country ?? current.country,
      phone: input.phone ?? current.phone,
      is_default: input.isDefault === true ? 1 : input.isDefault === false ? 0 : current.is_default,
      updated_at: nowIso(),
    };
    // An account must keep exactly one default while addresses exist.
    if (updated.is_default === 0) {
      const defaults = asSingle<{ count: number }>(
        db.prepare('SELECT COUNT(*) AS count FROM addresses WHERE user_id = ? AND is_default = 1 AND id != ?').get(
          userId, addressId,
        ),
      );
      if ((defaults?.count ?? 0) === 0) {
        updated.is_default = 1;
      }
    }
    db.prepare(
      `UPDATE addresses SET label = ?, full_name = ?, line1 = ?, line2 = ?, city = ?, state = ?,
       postal_code = ?, country = ?, phone = ?, is_default = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    ).run(
      updated.label, updated.full_name, updated.line1, updated.line2, updated.city, updated.state,
      updated.postal_code, updated.country, updated.phone, updated.is_default, updated.updated_at,
      addressId, userId,
    );
    return updated;
  },
);

export const deleteAddress = db.transaction((userId: string, addressId: string): void => {
  const current = getAddress(userId, addressId);
  if (current === undefined) {
    throw new HttpError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
  }
  db.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(addressId, userId);
  if (current.is_default === 1) {
    // Promote the oldest remaining address so a default always exists.
    const oldest = asSingle<{ id: string }>(
      db.prepare('SELECT id FROM addresses WHERE user_id = ? ORDER BY created_at ASC LIMIT 1').get(userId),
    );
    if (oldest !== undefined) {
      db.prepare('UPDATE addresses SET is_default = 1, updated_at = ? WHERE id = ?').run(nowIso(), oldest.id);
    }
  }
});

// ---------------------------------------------------------------------------
// Orders and eligibility.
// ---------------------------------------------------------------------------

export interface CreateOrderItemInput {
  id?: string;
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  /** Snapshot of the catalogue image so order history survives catalogue edits. */
  imageUrl?: string | null;
}

export interface CreateOrderInput {
  id?: string;
  orderNumber: string;
  customerId: string;
  status: string;
  subtotal?: number;
  createdAt?: string;
  deliveredAt?: string | null;
  items: CreateOrderItemInput[];
}

/** Insert an order with items. Used by seeding and tests; idempotent on ids. */
export const createOrder = db.transaction((input: CreateOrderInput): OrderRow => {
  const now = nowIso();
  const subtotal =
    input.subtotal ?? input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const order: OrderRow = {
    id: input.id ?? id(),
    order_number: input.orderNumber,
    customer_id: input.customerId,
    status: input.status,
    subtotal,
    created_at: input.createdAt ?? now,
    delivered_at: input.deliveredAt ?? null,
  };
  db.prepare(
    `INSERT OR IGNORE INTO orders (id, order_number, customer_id, status, subtotal, subtotal_paise, created_at, delivered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    order.id, order.order_number, order.customer_id, order.status, order.subtotal,
    Math.round(order.subtotal * 100), order.created_at, order.delivered_at,
  );
  const insertItem = db.prepare(
    `INSERT OR IGNORE INTO order_items (id, order_id, product_id, sku, product_name, quantity,
      unit_price, line_total, unit_price_paise, line_total_paise, product_image_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of input.items) {
    const unitPricePaise = Math.round(item.unitPrice * 100);
    insertItem.run(
      item.id ?? id(), order.id, item.productId, item.sku, item.productName,
      item.quantity, item.unitPrice, item.quantity * item.unitPrice,
      unitPricePaise, unitPricePaise * item.quantity, item.imageUrl ?? null,
    );
  }
  const stored = asSingle<OrderRow>(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id));
  if (stored === undefined) {
    throw new HttpError(500, 'ORDER_ERROR', 'Order could not be stored');
  }
  return stored;
});

export function listOrders(customerId: string): OrderRow[] {
  return asMany<OrderRow>(
    db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC').all(customerId),
  );
}

/** Quantity already tied up in non-cancelled returns for an order item. */
export function getClaimedQuantity(orderItemId: string): number {
  const row = asSingle<{ claimed: number }>(
    db.prepare(
      `SELECT COALESCE(SUM(ri.quantity), 0) AS claimed
       FROM return_items ri
       JOIN returns r ON r.id = ri.return_id
       WHERE ri.order_item_id = ? AND r.status != 'CANCELLED'`,
    ).get(orderItemId),
  );
  return row?.claimed ?? 0;
}

/** Load an order scoped to its owner, enriched with per-item eligibility. */
export function getOrderDetail(customerId: string, orderId: string): OrderDetail | null {
  const order = asSingle<OrderRow>(
    db.prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?').get(orderId, customerId),
  );
  if (order === undefined) {
    return null;
  }
  const items = asMany<OrderItemRow>(
    db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY product_name ASC').all(orderId),
  );
  const now = new Date();
  const delivered = order.delivered_at !== null;
  const withinWindow = delivered && daysSince(order.delivered_at as string, now) <= getReturnWindowDays();
  const eligibleUntil = delivered ? returnWindowEndIso(order.delivered_at as string) : null;
  const enriched: EligibleOrderItem[] = items.map((item) => {
    const remaining = Math.max(0, item.quantity - getClaimedQuantity(item.id));
    const eligible = withinWindow && remaining > 0;
    let ineligibleReason: string | null = null;
    if (!eligible) {
      if (!delivered) {
        ineligibleReason = 'Available once the order is delivered';
      } else if (!withinWindow) {
        ineligibleReason = 'Return window expired';
      } else {
        ineligibleReason = 'Already returned';
      }
    }
    return { ...item, remaining_quantity: remaining, eligible, ineligibleReason };
  });
  const orderEligible = withinWindow && enriched.some((item) => item.eligible);
  let ineligibleReason: string | null = null;
  if (!orderEligible) {
    if (!delivered) {
      ineligibleReason = 'Available once the order is delivered';
    } else if (!withinWindow) {
      ineligibleReason = 'Return window expired';
    } else {
      ineligibleReason = 'Every item on this order has already been returned';
    }
  }
  // Resolution rules depend on the reason chosen, so publish the whole map and
  // let the client narrow the choices without re-implementing the rules.
  const resolutionsByReason: Record<string, ResolutionType[]> = {};
  for (const reason of listActiveReasons()) {
    resolutionsByReason[reason.code] = [...allowedResolutions([reason.code], order.delivered_at)];
  }
  return { order, items: enriched, eligible: orderEligible, eligibleUntil, ineligibleReason, resolutionsByReason };
}

// ---------------------------------------------------------------------------
// Return reasons and number generators.
// ---------------------------------------------------------------------------

export function listActiveReasons(): ReasonRow[] {
  return asMany<ReasonRow>(
    db.prepare('SELECT * FROM return_reasons WHERE active = 1 ORDER BY sort_order ASC, label ASC').all(),
  );
}

/** Next RET-YYYY-NNNN return number backed by a yearly counter table. */
export function nextReturnNumber(): string {
  const year = String(new Date().getUTCFullYear());
  const next = db.transaction((): string => {
    db.prepare('INSERT OR IGNORE INTO return_counter (year, last_seq) VALUES (?, 0)').run(year);
    const row = asSingle<{ last_seq: number }>(
      db.prepare('SELECT last_seq FROM return_counter WHERE year = ?').get(year),
    );
    const seq = (row?.last_seq ?? 0) + 1;
    db.prepare('UPDATE return_counter SET last_seq = ? WHERE year = ?').run(seq, year);
    return seq.toString().padStart(4, '0');
  })();
  return `RET-${year}-${next}`;
}

/** Next TCK-YYYY-NNNN support ticket number backed by a yearly counter table. */
export function nextTicketNumber(): string {
  const year = String(new Date().getUTCFullYear());
  const next = db.transaction((): string => {
    db.prepare('INSERT OR IGNORE INTO ticket_counter (year, last_seq) VALUES (?, 0)').run(year);
    const row = asSingle<{ last_seq: number }>(
      db.prepare('SELECT last_seq FROM ticket_counter WHERE year = ?').get(year),
    );
    const seq = (row?.last_seq ?? 0) + 1;
    db.prepare('UPDATE ticket_counter SET last_seq = ? WHERE year = ?').run(seq, year);
    return seq.toString().padStart(4, '0');
  })();
  return `TCK-${year}-${next}`;
}

const REFUND_ONLY_REASONS = new Set(['DEFECTIVE', 'DAMAGED']);

/**
 * Resolve the allowed resolution types for a set of reason codes, given the
 * age of the delivery. DEFECTIVE and DAMAGED items exclude store credit,
 * CHANGED_MIND degrades to store credit only after 14 days, and every other
 * reason permits all resolution types.
 */
export function allowedResolutions(reasonCodes: string[], deliveredAt: string | null): Set<ResolutionType> {
  const all: Set<ResolutionType> = new Set(['REFUND', 'REPLACEMENT', 'EXCHANGE', 'STORE_CREDIT']);
  const now = new Date();
  const daysOld = deliveredAt === null ? Number.POSITIVE_INFINITY : daysSince(deliveredAt, now);
  let allowed: Set<ResolutionType> = new Set(all);
  for (const code of reasonCodes) {
    let forReason: Set<ResolutionType>;
    if (REFUND_ONLY_REASONS.has(code)) {
      forReason = new Set(['REFUND', 'REPLACEMENT', 'EXCHANGE']);
    } else if (code === 'CHANGED_MIND') {
      forReason = daysOld <= getChangedMindRefundDays()
        ? new Set<ResolutionType>(['REFUND', 'STORE_CREDIT'])
        : new Set<ResolutionType>(['STORE_CREDIT']);
    } else {
      forReason = new Set(all);
    }
    allowed = new Set([...allowed].filter((entry) => forReason.has(entry)));
  }
  return allowed;
}

// ---------------------------------------------------------------------------
// Returns.
// ---------------------------------------------------------------------------

/**
 * Append a customer-visible timeline event. Exported because warehouse
 * operations drive the same timeline the customer reads; there is one event
 * stream, not one per platform.
 */
export function insertReturnEvent(returnId: string, status: string, description: string | null): void {
  db.prepare('INSERT INTO return_events (id, return_id, status, description, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id(), returnId, status, description, nowIso(),
  );
}

export const createReturn = db.transaction((customerId: string, input: ReturnCreateInput): ReturnDetail => {
  const order = asSingle<OrderRow>(
    db.prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?').get(input.orderId, customerId),
  );
  if (order === undefined) {
    throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  if (order.delivered_at === null || daysSince(order.delivered_at, new Date()) > getReturnWindowDays()) {
    throw new HttpError(422, 'RETURN_WINDOW_EXPIRED', 'This order is outside the return window');
  }

  const itemsById = new Map<string, OrderItemRow>();
  for (const row of asMany<OrderItemRow>(
    db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id),
  )) {
    itemsById.set(row.id, row);
  }

  const reasonCodes: string[] = [];
  for (const entry of input.items) {
    const orderItem = itemsById.get(entry.orderItemId);
    if (orderItem === undefined) {
      throw new HttpError(422, 'INVALID_ORDER_ITEM', 'One or more items do not belong to this order');
    }
    const reason = asSingle<ReasonRow>(db.prepare('SELECT * FROM return_reasons WHERE code = ?').get(entry.reasonCode));
    if (reason === undefined || reason.active !== 1) {
      throw new HttpError(422, 'INVALID_REASON', `Return reason is not valid: ${entry.reasonCode}`);
    }
    const remaining = Math.max(0, orderItem.quantity - getClaimedQuantity(orderItem.id));
    if (entry.quantity > remaining) {
      throw new HttpError(
        422, 'QUANTITY_EXCEEDS_REMAINING',
        `Requested quantity exceeds the remaining quantity for ${orderItem.product_name}`,
      );
    }
    reasonCodes.push(reason.code);
  }

  const allowed = allowedResolutions(reasonCodes, order.delivered_at);
  if (!allowed.has(input.resolutionType)) {
    throw new HttpError(
      422, 'RESOLUTION_NOT_ALLOWED',
      `Resolution ${input.resolutionType} is not allowed for the selected reasons`,
    );
  }

  const now = nowIso();
  const returnNumber = nextReturnNumber();
  const returnId = id();
  const pickupKind: PickupKind = input.pickupKind;

  db.prepare(
    `INSERT INTO returns (id, return_number, order_id, customer_id, status, resolution_type, description, created_at, updated_at, cancelled_at, cancel_reason)
     VALUES (?, ?, ?, ?, 'REQUESTED', ?, ?, ?, ?, NULL, NULL)`,
  ).run(returnId, returnNumber, order.id, customerId, input.resolutionType, input.description ?? null, now, now);

  const insertItem = db.prepare(
    'INSERT INTO return_items (id, return_id, order_item_id, quantity, reason_code, description) VALUES (?, ?, ?, ?, ?, ?)',
  );
  // Accumulated in integer paise so no rounding error can accrue across lines.
  let refundAmountPaise = 0;
  for (const entry of input.items) {
    const orderItem = itemsById.get(entry.orderItemId);
    if (orderItem === undefined) {
      throw new HttpError(422, 'INVALID_ORDER_ITEM', 'One or more items do not belong to this order');
    }
    insertItem.run(id(), returnId, entry.orderItemId, entry.quantity, entry.reasonCode, entry.description ?? null);
    refundAmountPaise += entry.quantity * readPaise(orderItem.unit_price_paise, orderItem.unit_price);
  }

  insertReturnEvent(returnId, 'REQUESTED', 'Return request created by the customer');

  db.prepare(
    `INSERT INTO pickups (id, return_id, kind, address, date, time_window, carrier, tracking_number, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'SCHEDULED', ?, ?)`,
  ).run(id(), returnId, pickupKind, input.pickupAddress ?? null, input.pickupDate ?? null, input.timeWindow ?? null, now, now);

  db.prepare(
    `INSERT INTO refunds (id, return_id, kind, amount, amount_paise, method, status, initiated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
  ).run(
    id(), returnId, input.resolutionType, paiseToRupees(refundAmountPaise), refundAmountPaise, 'PENDING', now,
  );

  createNotification(customerId, {
    returnId,
    type: 'RETURN_CREATED',
    title: 'Return request received',
    body: `Return ${returnNumber} was created and is awaiting review.`,
  });

  const detail = getReturnDetail(customerId, returnId);
  if (detail === null) {
    throw new HttpError(500, 'RETURN_ERROR', 'Return could not be loaded after creation');
  }
  return detail;
});

export interface EnrichedReturnRow extends ReturnRow {
  productName: string | null;
  productImageUrl: string | null;
  itemQuantity: number;
  orderNumber: string | null;
}

export interface EnrichedReturnItemRow extends ReturnItemRow {
  productName: string | null;
  sku: string | null;
  productImageUrl: string | null;
  unitPrice: number | null;
}

export interface EnrichedReturnDetail extends Omit<ReturnDetail, 'items'> {
  items: EnrichedReturnItemRow[];
}

export function listReturns(customerId: string): EnrichedReturnRow[] {
  const rows = asMany<ReturnRow>(
    db.prepare('SELECT * FROM returns WHERE customer_id = ? ORDER BY created_at DESC').all(customerId),
  );
  return rows.map((ret) => {
    const order = asSingle<{ order_number: string }>(
      db.prepare('SELECT order_number FROM orders WHERE id = ?').get(ret.order_id),
    );
    const first = asSingle<{ product_name: string; product_image_url: string | null }>(
      db.prepare(
        `SELECT oi.product_name AS product_name, oi.product_image_url AS product_image_url
         FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
         WHERE ri.return_id = ? LIMIT 1`,
      ).get(ret.id),
    );
    const sum = asSingle<{ total: number }>(
      db.prepare('SELECT COALESCE(SUM(quantity), 0) AS total FROM return_items WHERE return_id = ?').get(ret.id),
    );
    return {
      ...ret,
      productName: first?.product_name ?? null,
      productImageUrl: first?.product_image_url ?? null,
      itemQuantity: sum?.total ?? 0,
      orderNumber: order?.order_number ?? null,
    };
  });
}

export function getReturnDetail(customerId: string, returnId: string): EnrichedReturnDetail | null {
  const ret = asSingle<ReturnRow>(
    db.prepare('SELECT * FROM returns WHERE id = ? AND customer_id = ?').get(returnId, customerId),
  );
  if (ret === undefined) {
    return null;
  }
  const items = asMany<EnrichedReturnItemRow>(
    db.prepare(
      `SELECT ri.*, oi.product_name AS productName, oi.sku AS sku,
              oi.product_image_url AS productImageUrl, oi.unit_price AS unitPrice
       FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
       WHERE ri.return_id = ?`,
    ).all(returnId),
  );
  const events = asMany<ReturnEventRow>(
    db.prepare('SELECT * FROM return_events WHERE return_id = ? ORDER BY created_at ASC').all(returnId),
  );
  const pickup = asSingle<PickupRow>(db.prepare('SELECT * FROM pickups WHERE return_id = ?').get(returnId)) ?? null;
  const refund = asSingle<RefundRow>(db.prepare('SELECT * FROM refunds WHERE return_id = ?').get(returnId)) ?? null;
  const order = asSingle<OrderRow>(db.prepare('SELECT * FROM orders WHERE id = ?').get(ret.order_id)) ?? null;
  return { ret, items, events, pickup, refund, order };
}

/**
 * Look up a return by its public number without scoping by owner. Callers
 * must enforce ownership and return 404 for foreign numbers so existence is
 * never leaked across accounts.
 */
export function findReturnByNumber(returnNumber: string): ReturnRow | undefined {
  return asSingle<ReturnRow>(
    db.prepare('SELECT * FROM returns WHERE return_number = ?').get(returnNumber),
  );
}

export const cancelReturn = db.transaction((customerId: string, returnId: string, reason: string): ReturnRow => {
  const ret = asSingle<ReturnRow>(
    db.prepare('SELECT * FROM returns WHERE id = ? AND customer_id = ?').get(returnId, customerId),
  );
  if (ret === undefined) {
    throw new HttpError(404, 'RETURN_NOT_FOUND', 'Return not found');
  }
  if (ret.status !== 'REQUESTED' && ret.status !== 'APPROVED') {
    throw new HttpError(409, 'CANCEL_NOT_ALLOWED', 'Only requested or approved returns can be cancelled');
  }
  const now = nowIso();
  db.prepare(
    "UPDATE returns SET status = 'CANCELLED', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?",
  ).run(now, reason, now, returnId);
  db.prepare('UPDATE pickups SET status = ?, updated_at = ? WHERE return_id = ?').run('CANCELLED', now, returnId);
  db.prepare('UPDATE refunds SET status = ? WHERE return_id = ?').run('CANCELLED', returnId);
  insertReturnEvent(returnId, 'CANCELLED', `Return cancelled by the customer: ${reason}`);
  createNotification(customerId, {
    returnId,
    type: 'RETURN_CANCELLED',
    title: 'Return cancelled',
    body: `Return ${ret.return_number} was cancelled.`,
  });
  const updated = asSingle<ReturnRow>(db.prepare('SELECT * FROM returns WHERE id = ?').get(returnId));
  if (updated === undefined) {
    throw new HttpError(500, 'RETURN_ERROR', 'Return could not be loaded after cancellation');
  }
  return updated;
});

export function listReturnEvents(returnId: string): ReturnEventRow[] {
  return asMany<ReturnEventRow>(
    db.prepare('SELECT * FROM return_events WHERE return_id = ? ORDER BY created_at ASC').all(returnId),
  );
}

export function addReturnEvent(returnId: string, status: string, description: string | null): ReturnEventRow {
  const event: ReturnEventRow = { id: id(), return_id: returnId, status, description, created_at: nowIso() };
  db.prepare('INSERT INTO return_events (id, return_id, status, description, created_at) VALUES (?, ?, ?, ?, ?)').run(
    event.id, event.return_id, event.status, event.description, event.created_at,
  );
  return event;
}

// ---------------------------------------------------------------------------
// Notifications.
// ---------------------------------------------------------------------------

export function createNotification(
  userId: string,
  input: { returnId?: string; type: string; title: string; body: string },
): NotificationRow {
  const row: NotificationRow = {
    id: id(), user_id: userId, return_id: input.returnId ?? null,
    type: input.type, title: input.title, body: input.body,
    is_read: 0, created_at: nowIso(),
  };
  db.prepare(
    'INSERT INTO notifications (id, user_id, return_id, type, title, body, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
  ).run(row.id, row.user_id, row.return_id, row.type, row.title, row.body, row.created_at);
  return row;
}

export function listNotifications(userId: string, unreadOnly: boolean): NotificationRow[] {
  if (unreadOnly) {
    return asMany<NotificationRow>(
      db.prepare('SELECT * FROM notifications WHERE user_id = ? AND is_read = 0 ORDER BY created_at DESC').all(userId),
    );
  }
  return asMany<NotificationRow>(
    db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC').all(userId),
  );
}

export function markNotificationRead(userId: string, notificationId: string): boolean {
  const result = db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(
    notificationId, userId,
  );
  return result.changes > 0;
}

export function markAllNotificationsRead(userId: string): number {
  const result = db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId);
  return Number(result.changes);
}

// ---------------------------------------------------------------------------
// Documents.
// ---------------------------------------------------------------------------

export function createDocument(input: {
  returnId: string;
  userId: string;
  kind: string;
  filename: string;
  mime: string;
  size: number;
  storagePath: string;
}): DocumentRow {
  const row: DocumentRow = {
    id: id(), return_id: input.returnId, user_id: input.userId, kind: input.kind,
    filename: input.filename, mime: input.mime, size: input.size,
    storage_path: input.storagePath, created_at: nowIso(),
  };
  db.prepare(
    'INSERT INTO documents (id, return_id, user_id, kind, filename, mime, size, storage_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(row.id, row.return_id, row.user_id, row.kind, row.filename, row.mime, row.size, row.storage_path, row.created_at);
  return row;
}

/** List documents for a return, or null when the return is missing or foreign. */
export function listDocumentsByReturn(customerId: string, returnId: string): DocumentRow[] | null {
  const ret = asSingle<ReturnRow>(
    db.prepare('SELECT id FROM returns WHERE id = ? AND customer_id = ?').get(returnId, customerId),
  );
  if (ret === undefined) {
    return null;
  }
  return asMany<DocumentRow>(
    db.prepare('SELECT * FROM documents WHERE return_id = ? ORDER BY created_at DESC').all(returnId),
  );
}

/** Load a single document only when it belongs to the requesting customer. */
export function getDocument(customerId: string, documentId: string): DocumentRow | undefined {
  return asSingle<DocumentRow>(
    db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(documentId, customerId),
  );
}

// ---------------------------------------------------------------------------
// Support tickets.
// ---------------------------------------------------------------------------

export const createTicket = db.transaction(
  (userId: string, input: { subject: string; body: string; returnId?: string }): { ticket: TicketRow; message: TicketMessageRow } => {
    if (input.returnId !== undefined) {
      const ret = asSingle<ReturnRow>(
        db.prepare('SELECT id FROM returns WHERE id = ? AND customer_id = ?').get(input.returnId, userId),
      );
      if (ret === undefined) {
        throw new HttpError(404, 'RETURN_NOT_FOUND', 'Return not found');
      }
    }
    const now = nowIso();
    const ticket: TicketRow = {
      id: id(), ticket_number: nextTicketNumber(), user_id: userId,
      return_id: input.returnId ?? null, subject: input.subject,
      status: 'OPEN', created_at: now, updated_at: now,
    };
    db.prepare(
      'INSERT INTO support_tickets (id, ticket_number, user_id, return_id, subject, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(ticket.id, ticket.ticket_number, ticket.user_id, ticket.return_id, ticket.subject, ticket.status, ticket.created_at, ticket.updated_at);
    const message: TicketMessageRow = { id: id(), ticket_id: ticket.id, author_role: 'CUSTOMER', body: input.body, created_at: now };
    db.prepare('INSERT INTO support_messages (id, ticket_id, author_role, body, created_at) VALUES (?, ?, ?, ?, ?)').run(
      message.id, message.ticket_id, message.author_role, message.body, message.created_at,
    );
    return { ticket, message };
  },
);

export function listTickets(userId: string): TicketRow[] {
  return asMany<TicketRow>(
    db.prepare('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC').all(userId),
  );
}

export function getTicketDetail(userId: string, ticketId: string): { ticket: TicketRow; messages: TicketMessageRow[] } | null {
  const ticket = asSingle<TicketRow>(
    db.prepare('SELECT * FROM support_tickets WHERE id = ? AND user_id = ?').get(ticketId, userId),
  );
  if (ticket === undefined) {
    return null;
  }
  const messages = asMany<TicketMessageRow>(
    db.prepare('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC').all(ticketId),
  );
  return { ticket, messages };
}

export function addTicketMessage(userId: string, ticketId: string, body: string): TicketMessageRow | null {
  const ticket = asSingle<TicketRow>(
    db.prepare('SELECT * FROM support_tickets WHERE id = ? AND user_id = ?').get(ticketId, userId),
  );
  if (ticket === undefined) {
    return null;
  }
  if (ticket.status === 'CLOSED') {
    throw new HttpError(409, 'TICKET_CLOSED', 'Closed tickets cannot receive new messages');
  }
  const message: TicketMessageRow = { id: id(), ticket_id: ticketId, author_role: 'CUSTOMER', body, created_at: nowIso() };
  db.prepare('INSERT INTO support_messages (id, ticket_id, author_role, body, created_at) VALUES (?, ?, ?, ?, ?)').run(
    message.id, message.ticket_id, message.author_role, message.body, message.created_at,
  );
  db.prepare('UPDATE support_tickets SET updated_at = ? WHERE id = ?').run(nowIso(), ticketId);
  return message;
}

export function closeTicket(userId: string, ticketId: string): TicketRow | null {
  const ticket = asSingle<TicketRow>(
    db.prepare('SELECT * FROM support_tickets WHERE id = ? AND user_id = ?').get(ticketId, userId),
  );
  if (ticket === undefined) {
    return null;
  }
  const now = nowIso();
  db.prepare("UPDATE support_tickets SET status = 'CLOSED', updated_at = ? WHERE id = ?").run(now, ticketId);
  return { ...ticket, status: 'CLOSED', updated_at: now };
}

// ---------------------------------------------------------------------------
// Feedback (one per return).
// ---------------------------------------------------------------------------

export function createFeedback(userId: string, input: { returnId: string; rating: number; comment?: string }): FeedbackRow {
  const ret = asSingle<ReturnRow>(
    db.prepare('SELECT id FROM returns WHERE id = ? AND customer_id = ?').get(input.returnId, userId),
  );
  if (ret === undefined) {
    throw new HttpError(404, 'RETURN_NOT_FOUND', 'Return not found');
  }
  const existing = asSingle<FeedbackRow>(
    db.prepare('SELECT * FROM feedback WHERE return_id = ?').get(input.returnId),
  );
  if (existing !== undefined) {
    throw new HttpError(409, 'FEEDBACK_EXISTS', 'Feedback was already submitted for this return');
  }
  const row: FeedbackRow = {
    id: id(), return_id: input.returnId, user_id: userId,
    rating: input.rating, comment: input.comment ?? null, created_at: nowIso(),
  };
  db.prepare('INSERT INTO feedback (id, return_id, user_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    row.id, row.return_id, row.user_id, row.rating, row.comment, row.created_at,
  );
  return row;
}

export function getFeedbackByReturn(userId: string, returnId: string): FeedbackRow | null {
  const ret = asSingle<ReturnRow>(
    db.prepare('SELECT id FROM returns WHERE id = ? AND customer_id = ?').get(returnId, userId),
  );
  if (ret === undefined) {
    return null;
  }
  return asSingle<FeedbackRow>(db.prepare('SELECT * FROM feedback WHERE return_id = ?').get(returnId)) ?? null;
}

// ---------------------------------------------------------------------------
// Commerce catalog, cart, checkout, store credit, and order tracking.
// All money values in this section are INTEGER paise. Legacy REAL columns
// (orders.subtotal, order_items.unit_price/line_total, refunds.amount) are
// written as paise/100 and rounded to whole paise before conversion.
// ---------------------------------------------------------------------------

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  description: string;
  details: string;
  price_paise: number;
  image_url: string;
  stock: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface CartLine {
  productId: string;
  sku: string;
  name: string;
  pricePaise: number;
  imageUrl: string;
  stock: number;
  quantity: number;
  lineTotalPaise: number;
}

export interface Cart {
  items: CartLine[];
  subtotalPaise: number;
  totalQuantity: number;
}

export interface LedgerRow {
  id: string;
  user_id: string;
  type: string;
  amount_paise: number;
  reason: string | null;
  reference_type: string;
  reference_id: string;
  created_at: string;
}

export interface CheckoutQuote {
  addressId: string;
  items: CartLine[];
  subtotalPaise: number;
  shippingPaise: number;
  discountPaise: number;
  totalPaise: number;
  creditAvailablePaise: number;
  creditToUsePaise: number;
  payablePaise: number;
  totalQuantity: number;
}

export interface OrderEventRow {
  id: string;
  order_id: string;
  status: string;
  description: string | null;
  created_at: string;
}

export interface OrderTracking {
  orderNumber: string;
  status: string;
  trackingNumber: string | null;
  carrier: string | null;
  estimatedDelivery: string | null;
  events: OrderEventRow[];
}

// Shipping policy. The threshold sits inside the catalogue's price ladder so
// smaller baskets genuinely pay shipping and larger ones genuinely earn it.
export const FREE_SHIPPING_THRESHOLD_PAISE = 299900;
export const FLAT_SHIPPING_PAISE = 9900;

function toPaise(amount: number): number {
  return Math.round(amount);
}

/**
 * Render integer paise into the legacy REAL rupee columns. Those columns are
 * mirrors for backwards compatibility only; every calculation uses paise.
 */
function paiseToRupees(paise: number): number {
  return toPaise(paise) / 100;
}

/** Read the authoritative paise amount from a row that still carries a legacy REAL mirror. */
function readPaise(paiseColumn: number | null | undefined, rupeeColumn: number | null | undefined): number {
  if (paiseColumn !== null && paiseColumn !== undefined && paiseColumn !== 0) {
    return toPaise(paiseColumn);
  }
  return toPaise(Math.round((rupeeColumn ?? 0) * 100));
}

function generateTrackingNumber(): string {
  return `TRK${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function estimatedDeliveryIso(): string {
  return new Date(Date.now() + 5 * 86_400_000).toISOString();
}

/** Active catalog products ordered by name. */
export function listProducts(): ProductRow[] {
  return asMany<ProductRow>(db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY name ASC').all());
}

/** Load a single active product; inactive or missing products resolve to undefined. */
export function getProduct(productId: string): ProductRow | undefined {
  return asSingle<ProductRow>(db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(productId));
}

/** Next ORD-YYYY-NNNN order number backed by a yearly counter table. */
export function nextOrderNumber(): string {
  const year = String(new Date().getUTCFullYear());
  const next = db.transaction((): string => {
    db.prepare('INSERT OR IGNORE INTO order_counter (year, last_seq) VALUES (?, 0)').run(year);
    const row = asSingle<{ last_seq: number }>(
      db.prepare('SELECT last_seq FROM order_counter WHERE year = ?').get(year),
    );
    const seq = (row?.last_seq ?? 0) + 1;
    db.prepare('UPDATE order_counter SET last_seq = ? WHERE year = ?').run(seq, year);
    return seq.toString().padStart(4, '0');
  })();
  return `ORD-${year}-${next}`;
}

/** Load the current cart for a user, joined against the product catalog. */
export function getCart(userId: string): Cart {
  const rows = asMany<{ product_id: string; quantity: number; sku: string; name: string; price_paise: number; image_url: string; stock: number }>(
    db.prepare(
      `SELECT ci.product_id, ci.quantity, p.sku, p.name, p.price_paise, p.image_url, p.stock
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
       WHERE ci.user_id = ? ORDER BY p.name ASC`,
    ).all(userId),
  );
  const items: CartLine[] = rows.map((row) => ({
    productId: row.product_id,
    sku: row.sku,
    name: row.name,
    pricePaise: toPaise(row.price_paise),
    imageUrl: row.image_url,
    stock: row.stock,
    quantity: row.quantity,
    lineTotalPaise: toPaise(row.price_paise) * row.quantity,
  }));
  const subtotalPaise = items.reduce((sum, item) => sum + item.lineTotalPaise, 0);
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  return { items, subtotalPaise, totalQuantity };
}

/** Add a quantity to the cart, validating stock and product visibility. */
export const addToCart = db.transaction((userId: string, productId: string, quantity: number): Cart => {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Quantity must be at least 1');
  }
  const product = getProduct(productId);
  if (product === undefined) {
    throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  }
  const existing = asSingle<{ quantity: number }>(
    db.prepare('SELECT quantity FROM cart_items WHERE user_id = ? AND product_id = ?').get(userId, productId),
  );
  const nextQuantity = (existing?.quantity ?? 0) + quantity;
  if (nextQuantity > product.stock) {
    throw new HttpError(409, 'INSUFFICIENT_STOCK', `Only ${product.stock} units available for ${product.name}`);
  }
  const now = nowIso();
  db.prepare(
    'INSERT INTO cart_items (user_id, product_id, quantity, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, product_id) DO UPDATE SET quantity = ?, updated_at = ?',
  ).run(userId, productId, nextQuantity, now, nextQuantity, now);
  return getCart(userId);
});

/** Set an exact cart quantity; zero removes the line. */
export const setCartQuantity = db.transaction((userId: string, productId: string, quantity: number): Cart => {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Quantity must be a non-negative integer');
  }
  if (quantity === 0) {
    db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(userId, productId);
    return getCart(userId);
  }
  const product = getProduct(productId);
  if (product === undefined) {
    throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  }
  if (quantity > product.stock) {
    throw new HttpError(409, 'INSUFFICIENT_STOCK', `Only ${product.stock} units available for ${product.name}`);
  }
  const now = nowIso();
  db.prepare(
    'INSERT INTO cart_items (user_id, product_id, quantity, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, product_id) DO UPDATE SET quantity = ?, updated_at = ?',
  ).run(userId, productId, quantity, now, quantity, now);
  return getCart(userId);
});

/** Remove a line from the cart. Scoped by user so foreign lines are untouched. */
export const removeFromCart = db.transaction((userId: string, productId: string): Cart => {
  db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(userId, productId);
  return getCart(userId);
});

/** Current store-credit balance in paise (credits minus debits). */
export function creditBalance(userId: string): number {
  const row = asSingle<{ balance: number }>(
    db.prepare('SELECT COALESCE(SUM(amount_paise), 0) AS balance FROM store_credit_ledger WHERE user_id = ?').get(userId),
  );
  return toPaise(row?.balance ?? 0);
}

/** Store-credit ledger history, newest first. */
export function creditHistory(userId: string): LedgerRow[] {
  return asMany<LedgerRow>(
    db.prepare('SELECT * FROM store_credit_ledger WHERE user_id = ? ORDER BY created_at DESC').all(userId),
  );
}

/**
 * Insert a ledger entry with idempotent dedupe on (reference_type, reference_id).
 * On conflict the already-applied row is returned unchanged.
 */
export function addLedgerEntry(input: {
  userId: string;
  type: string;
  amountPaise: number;
  reason: string | null;
  referenceType: string;
  referenceId: string;
}): LedgerRow {
  const amount = toPaise(input.amountPaise);
  const now = nowIso();
  const entryId = id();
  const result = db
    .prepare(
      'INSERT OR IGNORE INTO store_credit_ledger (id, user_id, type, amount_paise, reason, reference_type, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(entryId, input.userId, input.type, amount, input.reason, input.referenceType, input.referenceId, now);
  if (result.changes === 0) {
    const existing = asSingle<LedgerRow>(
      db.prepare('SELECT * FROM store_credit_ledger WHERE reference_type = ? AND reference_id = ?').get(
        input.referenceType, input.referenceId,
      ),
    );
    if (existing === undefined) {
      throw new HttpError(500, 'LEDGER_ERROR', 'Store credit entry could not be loaded');
    }
    return existing;
  }
  const created = asSingle<LedgerRow>(db.prepare('SELECT * FROM store_credit_ledger WHERE id = ?').get(entryId));
  if (created === undefined) {
    throw new HttpError(500, 'LEDGER_ERROR', 'Store credit entry could not be loaded');
  }
  return created;
}

/** Price a checkout without side effects: shipping, discount, and credit cap. */
export function quoteCheckout(userId: string, input: { addressId: string; useStoreCredit?: boolean }): CheckoutQuote {
  const address = asSingle<AddressRow>(
    db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(input.addressId, userId),
  );
  if (address === undefined) {
    throw new HttpError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
  }
  const cart = getCart(userId);
  if (cart.items.length === 0) {
    throw new HttpError(400, 'EMPTY_CART', 'Cart is empty');
  }
  for (const line of cart.items) {
    const product = getProduct(line.productId);
    if (product === undefined) {
      throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    }
    if (line.quantity > product.stock) {
      throw new HttpError(409, 'INSUFFICIENT_STOCK', `Only ${product.stock} units available for ${product.name}`);
    }
  }
  const subtotalPaise = toPaise(cart.subtotalPaise);
  const shippingPolicy = getShippingPolicy();
  const shippingPaise = subtotalPaise >= shippingPolicy.thresholdPaise ? 0 : shippingPolicy.flatPaise;
  const discountPaise = 0;
  const totalPaise = toPaise(subtotalPaise + shippingPaise - discountPaise);
  const creditAvailablePaise = creditBalance(userId);
  const creditToUsePaise = input.useStoreCredit ? Math.min(Math.max(creditAvailablePaise, 0), totalPaise) : 0;
  const payablePaise = toPaise(totalPaise - creditToUsePaise);
  return {
    addressId: address.id,
    items: cart.items,
    subtotalPaise,
    shippingPaise,
    discountPaise,
    totalPaise,
    creditAvailablePaise,
    creditToUsePaise,
    payablePaise,
    totalQuantity: cart.totalQuantity,
  };
}

function insertOrderEvent(orderId: string, status: string, description: string | null): void {
  db.prepare('INSERT INTO order_events (id, order_id, status, description, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id(), orderId, status, description, nowIso(),
  );
}

export function addOrderEvent(orderId: string, status: string, description: string | null): OrderEventRow {
  const event: OrderEventRow = { id: id(), order_id: orderId, status, description, created_at: nowIso() };
  db.prepare('INSERT INTO order_events (id, order_id, status, description, created_at) VALUES (?, ?, ?, ?, ?)').run(
    event.id, event.order_id, event.status, event.description, event.created_at,
  );
  return event;
}

/** Customer-scoped order tracking timeline. Throws 404 for foreign orders. */
export function getOrderTracking(customerId: string, orderId: string): OrderTracking {
  const order = asSingle<OrderRow>(
    db.prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?').get(orderId, customerId),
  );
  if (order === undefined) {
    throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  const events = asMany<OrderEventRow>(
    db.prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at ASC').all(orderId),
  );
  return {
    orderNumber: order.order_number,
    status: order.status,
    trackingNumber: order.tracking_number ?? null,
    carrier: order.carrier ?? null,
    estimatedDelivery: order.estimated_delivery ?? null,
    events,
  };
}

export interface CheckoutResult {
  detail: OrderDetail;
  replayed: boolean;
}

/**
 * Place an order atomically: re-validates the quote, decrements stock with a
 * guarded UPDATE, snapshots items and the address, applies store credit via
 * the ledger, clears the cart, and records idempotency, events, and alerts.
 */
export function checkout(
  userId: string,
  input: { addressId: string; useStoreCredit?: boolean; idempotencyKey: string },
): CheckoutResult {
  const key = input.idempotencyKey?.trim() ?? '';
  if (key.length === 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Idempotency key is required');
  }
  const existingKey = asSingle<{ key: string; user_id: string; order_id: string }>(
    db.prepare('SELECT * FROM idempotency_keys WHERE key = ?').get(key),
  );
  if (existingKey !== undefined) {
    if (existingKey.user_id !== userId) {
      throw new HttpError(409, 'IDEMPOTENCY_KEY_USED', 'Idempotency key is already in use');
    }
    const replayDetail = getOrderDetail(userId, existingKey.order_id);
    if (replayDetail === null) {
      throw new HttpError(500, 'ORDER_ERROR', 'Order could not be loaded');
    }
    return { detail: replayDetail, replayed: true };
  }

  const run = db.transaction((): CheckoutResult => {
    const quote = quoteCheckout(userId, { addressId: input.addressId, useStoreCredit: input.useStoreCredit });
    const address = asSingle<AddressRow>(
      db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(input.addressId, userId),
    );
    if (address === undefined) {
      throw new HttpError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
    }
    const now = nowIso();
    const orderId = id();
    const orderNumber = nextOrderNumber();

    // Decrement stock through the inventory engine so the sale lands on
    // products.stock and the warehouse AVAILABLE bucket in one transaction.
    // The guard lives in the UPDATE's WHERE clause, so concurrent checkouts
    // cannot both observe enough stock and oversell.
    for (const line of quote.items) {
      const sold = consumeAvailableStock({
        warehouseId: DEFAULT_WAREHOUSE_ID,
        productId: line.productId,
        quantity: line.quantity,
        orderId,
      });
      if (!sold) {
        throw new HttpError(409, 'INSUFFICIENT_STOCK', `Insufficient stock for ${line.name}`);
      }
    }

    const trackingNumber = generateTrackingNumber();
    const estimatedDelivery = estimatedDeliveryIso();
    const addressSnapshot = JSON.stringify(address);
    db.prepare(
      `INSERT INTO orders (id, order_number, customer_id, status, subtotal, subtotal_paise, created_at, delivered_at,
        shipping_address, payment_status, payment_method, carrier, tracking_number, kind,
        source_return_id, credit_used_paise, shipping_paise, discount_paise, estimated_delivery)
       VALUES (?, ?, ?, 'PLACED', ?, ?, ?, NULL, ?, 'PAID', 'TEST', 'ReturnOS Logistics', ?, 'STANDARD', NULL, ?, ?, ?, ?)`,
    ).run(
      orderId, orderNumber, userId, paiseToRupees(quote.subtotalPaise), toPaise(quote.subtotalPaise), now,
      addressSnapshot, trackingNumber, toPaise(quote.creditToUsePaise),
      toPaise(quote.shippingPaise), toPaise(quote.discountPaise), estimatedDelivery,
    );

    const insertItem = db.prepare(
      `INSERT INTO order_items (id, order_id, product_id, sku, product_name, quantity,
        unit_price, line_total, unit_price_paise, line_total_paise, product_image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const line of quote.items) {
      insertItem.run(
        id(), orderId, line.productId, line.sku, line.name, line.quantity,
        paiseToRupees(line.pricePaise), paiseToRupees(line.lineTotalPaise),
        toPaise(line.pricePaise), toPaise(line.lineTotalPaise), line.imageUrl,
      );
    }

    if (quote.creditToUsePaise > 0) {
      addLedgerEntry({
        userId,
        type: 'DEBIT',
        amountPaise: -toPaise(quote.creditToUsePaise),
        reason: `Store credit applied to order ${orderNumber}`,
        referenceType: 'ORDER',
        referenceId: orderId,
      });
    }

    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);
    db.prepare('INSERT INTO idempotency_keys (key, user_id, order_id, created_at) VALUES (?, ?, ?, ?)').run(
      key, userId, orderId, now,
    );
    insertOrderEvent(orderId, 'PLACED', 'Order placed by the customer');
    createNotification(userId, {
      type: 'ORDER_PLACED',
      title: 'Order placed',
      body: `Order ${orderNumber} was placed.`,
    });

    const detail = getOrderDetail(userId, orderId);
    if (detail === null) {
      throw new HttpError(500, 'ORDER_ERROR', 'Order could not be loaded after checkout');
    }
    return { detail, replayed: false };
  });

  return run();
}

/**
 * Finalize a return that reached RESOLVED. Idempotent: when the refund is
 * already COMPLETED or CANCELLED the call is a no-op. Handles REFUND (close
 * only), STORE_CREDIT (ledger credit exactly once via dedupe), and
 * REPLACEMENT/EXCHANGE (free replacement order with zero prices).
 */
export function resolveReturnAtResolved(returnId: string): void {
  const run = db.transaction(() => {
    const ret = asSingle<ReturnRow>(db.prepare('SELECT * FROM returns WHERE id = ?').get(returnId));
    if (ret === undefined) {
      return;
    }
    if (ret.status === 'RESOLVED') {
      return;
    }
    const refund = asSingle<RefundRow>(db.prepare('SELECT * FROM refunds WHERE return_id = ?').get(returnId));
    if (refund !== undefined && (refund.status === 'COMPLETED' || refund.status === 'CANCELLED')) {
      return;
    }
    const now = nowIso();
    const kind = refund?.kind ?? ret.resolution_type ?? 'REFUND';

    if (refund !== undefined && kind === 'STORE_CREDIT') {
      const amountPaise = readPaise(refund.amount_paise, refund.amount);
      if (amountPaise > 0) {
        addLedgerEntry({
          userId: ret.customer_id,
          type: 'CREDIT',
          amountPaise,
          reason: `Store credit from return ${ret.return_number}`,
          referenceType: 'RETURN',
          referenceId: ret.id,
        });
      }
      db.prepare('UPDATE refunds SET status = ?, completed_at = ? WHERE return_id = ?').run('COMPLETED', now, ret.id);
    } else if (refund !== undefined && (kind === 'REPLACEMENT' || kind === 'EXCHANGE')) {
      const returnLines = asMany<{ order_item_id: string; quantity: number }>(
        db.prepare('SELECT order_item_id, quantity FROM return_items WHERE return_id = ?').all(ret.id),
      );
      const replacementId = id();
      const replacementNumber = nextOrderNumber();
      const trackingNumber = generateTrackingNumber();
      db.prepare(
        `INSERT INTO orders (id, order_number, customer_id, status, subtotal, subtotal_paise, created_at, delivered_at,
          shipping_address, payment_status, payment_method, carrier, tracking_number, kind,
          source_return_id, credit_used_paise, shipping_paise, discount_paise, estimated_delivery)
         VALUES (?, ?, ?, 'PROCESSING', 0, 0, ?, NULL, NULL, 'PAID', 'TEST', 'ReturnOS Logistics', ?, ?, ?, 0, 0, 0, ?)`,
      ).run(
        replacementId, replacementNumber, ret.customer_id, now,
        trackingNumber, kind, ret.id, estimatedDeliveryIso(),
      );
      const insertItem = db.prepare(
        `INSERT INTO order_items (id, order_id, product_id, sku, product_name, quantity,
          unit_price, line_total, unit_price_paise, line_total_paise, product_image_url)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?)`,
      );
      const shippable: Array<{ productId: string; quantity: number }> = [];
      for (const line of returnLines) {
        const source = asSingle<{ product_id: string; sku: string; product_name: string; product_image_url: string | null }>(
          db.prepare('SELECT product_id, sku, product_name, product_image_url FROM order_items WHERE id = ?').get(
            line.order_item_id,
          ),
        );
        if (source === undefined) {
          continue;
        }
        insertItem.run(id(), replacementId, source.product_id, source.sku, source.product_name, line.quantity, source.product_image_url);
        shippable.push({ productId: source.product_id, quantity: line.quantity });
      }
      // The replacement units ship from the sellable pool, exactly like a
      // checkout sale: without this, every replacement cycle inflates
      // products.stock (the returned unit is restocked, the shipped unit is
      // never deducted). A shortfall is stamped, never swallowed — the
      // WARNING_* row surfaces on /warehouse/summary like every other clamp.
      const receiving = asSingle<{ warehouse_id: string }>(
        db.prepare('SELECT warehouse_id FROM receiving_records WHERE return_id = ?').get(ret.id),
      );
      let shipWarehouseId = DEFAULT_WAREHOUSE_ID;
      if (receiving !== undefined) {
        shipWarehouseId = receiving.warehouse_id;
      } else {
        // No receiving record means this resolve bypassed the warehouse floor
        // (today only direct engine calls do that — every warehouse path
        // receives before it can inspect or dispose). Fall back to the default
        // pool, but say so loudly: silently shipping from the wrong
        // warehouse's stock would be a real bug the day a second one opens.
        recordAudit({
          actorId: null,
          actorRole: 'SYSTEM',
          warehouseId: shipWarehouseId,
          action: 'WARNING_RESOLUTION_WAREHOUSE_FALLBACK',
          entityType: 'RETURN',
          entityId: ret.id,
          previousState: null,
          newState: null,
          metadata: {
            reason: 'Replacement resolved without a receiving record; shipped from the default warehouse',
            returnId: ret.id,
            returnNumber: ret.return_number,
            orderId: replacementId,
          },
        });
      }
      for (const ship of shippable) {
        const consumed = consumeAvailableStock({
          warehouseId: shipWarehouseId,
          productId: ship.productId,
          quantity: ship.quantity,
          orderId: replacementId,
        });
        if (!consumed) {
          recordAudit({
            actorId: null,
            actorRole: 'SYSTEM',
            warehouseId: shipWarehouseId,
            action: 'WARNING_REPLACEMENT_SHORTFALL',
            entityType: 'ORDER',
            entityId: replacementId,
            previousState: null,
            newState: null,
            metadata: {
              reason: 'Replacement shipment required more sellable units than products.stock held',
              returnId: ret.id,
              returnNumber: ret.return_number,
              productId: ship.productId,
              requested: ship.quantity,
              orderId: replacementId,
            },
          });
        }
      }
      insertOrderEvent(replacementId, 'PROCESSING', `Replacement order for return ${ret.return_number}`);
      createNotification(ret.customer_id, {
        type: 'ORDER_PLACED',
        title: 'Replacement order created',
        body: `Replacement order ${replacementNumber} was created for return ${ret.return_number}.`,
      });
      db.prepare('UPDATE refunds SET status = ?, completed_at = ? WHERE return_id = ?').run('COMPLETED', now, ret.id);
    } else if (refund !== undefined) {
      db.prepare('UPDATE refunds SET status = ?, completed_at = ? WHERE return_id = ?').run('COMPLETED', now, ret.id);
    }

    db.prepare('UPDATE returns SET status = ?, updated_at = ? WHERE id = ?').run('RESOLVED', now, ret.id);
    insertReturnEvent(ret.id, 'RESOLVED', 'Return resolved');
    createNotification(ret.customer_id, {
      returnId: ret.id,
      type: 'RETURN_RESOLVED',
      title: 'Return resolved',
      body: `Return ${ret.return_number} was resolved.`,
    });
  });
  run();
}
