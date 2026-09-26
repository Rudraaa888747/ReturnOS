/* Typed client for the ReturnOS admin API.
 * Same conventions as lib/api and lib/warehouse (token header, JSON
 * errors), scoped to /api/v1/admin. Read-heavy by design; the few writes
 * (catalog, credit, settings, users, tickets) post explicit payloads and
 * surface backend validation verbatim. No business logic lives here.
 */

import { ApiError, getToken } from './api';
import type { ApiErrorBody } from './api';

const ADMIN_BASE = `${import.meta.env.VITE_API_URL ?? ''}/api/v1/admin`;

interface AdOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export async function ad<T>(path: string, options: AdOptions = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${ADMIN_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body: ApiErrorBody =
      typeof data === 'object' && data !== null && 'code' in data
        ? (data as ApiErrorBody)
        : { code: 'REQUEST_FAILED', message: `Request failed with status ${response.status}` };
    throw new ApiError(response.status, body);
  }
  return data as T;
}

/** Download a CSV report; the backend sets filename + content type. */
export async function downloadReport(path: string): Promise<{ blob: Blob; filename: string }> {
  const token = getToken();
  const response = await fetch(`${ADMIN_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const body: ApiErrorBody =
      typeof data === 'object' && data !== null && 'code' in data
        ? (data as ApiErrorBody)
        : { code: 'REQUEST_FAILED', message: `Request failed with status ${response.status}` };
    throw new ApiError(response.status, body);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/);
  return { blob, filename: match ? match[1] : 'report.csv' };
}

/* ------------------------------------------------------------------ */
/* Shapes mirroring the admin API responses.                           */
/* ------------------------------------------------------------------ */

export interface DashboardSummary {
  commerce: { totalOrders: number; ordersToday: number; pendingOrders: number; deliveredOrders: number; cancelledOrders: number };
  returns: { totalReturns: number; newReturns: number; pendingReceiving: number; pendingInspection: number; pendingDisposition: number; completedReturns: number };
  financial: { refundsPending: number; refundsCompleted: number; refundsCompletedPaise: number; creditIssuedPaise: number; creditUsedPaise: number };
  warehouse: { pendingTasks: number; overdueTasks: number; inventoryAlerts: number };
  recovery: { recoveredValuePaise: number; restockedUnits: number; resaleUnits: number; repairUnits: number; vendorReturnUnits: number; disposalUnits: number };
  customers: { totalCustomers: number; newCustomers: number; activeCustomers: number };
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

export interface AdminCustomer {
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

export interface AdminCustomerDetail {
  user: { id: string; email: string; full_name: string; role: string; created_at: string; phone: string | null; active: number };
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

export interface AdminOrder {
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

export interface AdminOrderDetail {
  order: Record<string, string | number | null>;
  customer: { id: string; email: string; full_name: string };
  items: Array<Record<string, string | number | null>>;
  events: Array<{ id: string; status: string; description: string | null; created_at: string }>;
  returns: Array<{ id: string; return_number: string; status: string; resolution_type: string | null }>;
  refunds: Array<{ id: string; return_number: string; amount_paise: number; method: string | null; status: string }>;
  replacements: Array<{ id: string; order_number: string; kind: string | null; status: string; source_return_id: string | null }>;
}

export interface AdminReturn {
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

export interface AdminRefund {
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

export interface AdminWarehouse {
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

export interface AdminInventoryLine {
  product_id: string;
  sku: string;
  name: string;
  image_url: string | null;
  sellable_stock: number;
  buckets: Array<{ warehouse_id: string; warehouse_code: string | null; state: string; quantity: number }>;
}

export interface AdminTask {
  id: string;
  title: string;
  kind: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  due_at: string;
  warehouse_id: string;
  return_id: string | null;
  returnNumber?: string | null;
  orderNumber?: string | null;
  hoursRemaining?: number;
  overdue?: boolean;
}

export interface AdminProduct {
  id: string;
  sku: string;
  name: string;
  description: string;
  details: string;
  price_paise: number;
  image_url: string;
  stock: number;
  active: number;
  category_id: string | null;
  category_name: string | null;
  created_at: string;
  updated_at: string;
  open_orders?: number;
  open_returns?: number;
}

export interface AdminCategory {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  active: number;
  created_at: string;
  updated_at: string;
  product_count?: number;
}

export interface AdminTicket {
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

export interface AdminNotification {
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

export interface AdminTemplate {
  key: string;
  title: string;
  body: string;
  active: number;
  updated_at: string;
}

export interface AdminUserRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  active: number;
  created_at: string;
}

export interface AdminAuditEntry {
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

export interface SettingState {
  key: string;
  description: string;
  stored: unknown;
  effective: unknown;
  valid: boolean;
  default: unknown;
}
