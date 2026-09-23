/* Typed HTTP client for the ReturnOS customer API.
 * Base path is proxied to the backend in development (see vite.config.ts).
 * All requests and responses use proper English error messages from the API.
 */

const API_BASE = '/api/v1';
const TOKEN_KEY = 'returnos.token';

export interface ApiErrorBody {
  code: string;
  message: string;
  errors?: Array<{ path: string; message: string }>;
}

export class ApiError extends Error {
  status: number;
  code: string;
  errors?: Array<{ path: string; message: string }>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || 'Request failed');
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code || 'UNKNOWN_ERROR';
    this.errors = body.errors;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token === null) {
      localStorage.removeItem(TOKEN_KEY);
    } else {
      localStorage.setItem(TOKEN_KEY, token);
    }
  } catch {
    /* storage unavailable — session stays in memory only */
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = options.token !== undefined ? options.token : getToken();
  const response = await fetch(`${API_BASE}${path}`, {
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

export async function uploadFile<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const token = getToken();
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  form.append('file', file);
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form,
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body: ApiErrorBody =
      typeof data === 'object' && data !== null && 'code' in data
        ? (data as ApiErrorBody)
        : { code: 'UPLOAD_FAILED', message: `Upload failed with status ${response.status}` };
    throw new ApiError(response.status, body);
  }
  return data as T;
}

export function friendlyMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

/* ------------------------------------------------------------------ */
/* Domain types mirroring the backend response shapes.                 */
/* ------------------------------------------------------------------ */

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

export interface AuthResponse {
  user: PublicUser;
  token: string;
}

export interface ProfileView {
  user_id: string;
  phone: string | null;
  comm_prefs: string;
  notif_prefs: string;
  commPrefs?: Record<string, boolean>;
  notifPrefs?: Record<string, boolean>;
}

export interface OrderRow {
  id: string;
  order_number: string;
  customer_id: string;
  status: string;
  subtotal: number;
  created_at: string;
  delivered_at: string | null;
  /* Commerce enrichment (optional-tolerant; backend may or may not send these). */
  shipping_address?: string | null;
  shippingAddress?: string | null;
  payment_status?: string | null;
  paymentStatus?: string | null;
  carrier?: string | null;
  tracking_number?: string | null;
  trackingNumber?: string | null;
  kind?: string | null;
  credit_used_paise?: number | null;
  creditUsedPaise?: number | null;
  shipping_paise?: number | null;
  shippingPaise?: number | null;
  discount_paise?: number | null;
  discountPaise?: number | null;
  estimated_delivery?: string | null;
  estimatedDelivery?: string | null;
  subtotalPaise?: number | null;
  totalPaise?: number | null;
  total?: number | null;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  unit_price_paise?: number | null;
  line_total_paise?: number | null;
  /* Commerce enrichment (optional-tolerant). */
  product_image_url?: string | null;
  productImageUrl?: string | null;
}

export interface EligibleOrderItem extends OrderItemRow {
  remaining_quantity: number;
  eligible: boolean;
  ineligibleReason: string | null;
}

export interface OrderDetail {
  order: OrderRow;
  items: EligibleOrderItem[];
  eligible: boolean;
  /** End of the return window, ISO. Null until the order is delivered. */
  eligibleUntil: string | null;
  ineligibleReason: string | null;
  /** Resolutions the backend accepts, per reason code. Authoritative. */
  resolutionsByReason: Record<string, string[]>;
}

export interface ReasonRow {
  code: string;
  label: string;
  description: string | null;
  active: number;
}

export interface MetaConstants {
  resolutionTypes: string[];
  pickupKinds: string[];
  returnWindowDays: number;
  returnStatuses: string[];
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
  /* Commerce enrichment (optional-tolerant). */
  productName?: string | null;
  product_name?: string | null;
  productImageUrl?: string | null;
  product_image_url?: string | null;
  itemQuantity?: number | null;
  item_quantity?: number | null;
  orderNumber?: string | null;
  order_number_alias?: string | null;
}

export interface ReturnItemRow {
  id: string;
  return_id: string;
  order_item_id: string;
  quantity: number;
  reason_code: string;
  description: string | null;
  /* Commerce enrichment (optional-tolerant). */
  productName?: string | null;
  product_name?: string | null;
  sku?: string | null;
  productImageUrl?: string | null;
  product_image_url?: string | null;
  unitPrice?: number | null;
  unit_price?: number | null;
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
  amount: number | null;
  method: string | null;
  status: string;
  initiated_at: string | null;
  completed_at: string | null;
}

export interface ReturnDetail {
  ret: ReturnRow;
  items: ReturnItemRow[];
  events: ReturnEventRow[];
  pickup: PickupRow | null;
  refund: RefundRow | null;
  order: OrderRow | null;
}

export interface TrackingResult {
  returnNumber: string;
  status: string;
  resolutionType: string | null;
  updatedAt: string;
  events: ReturnEventRow[];
  pickup: PickupRow | null;
  refund: RefundRow | null;
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

export interface TicketDetail {
  ticket: TicketRow;
  messages: TicketMessageRow[];
}

export interface FeedbackRow {
  id: string;
  return_id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* Customer commerce types (products, cart, checkout, credit).         */
/* ------------------------------------------------------------------ */

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  details: string | null;
  pricePaise: number;
  imageUrl: string | null;
  stock: number;
  active: number | boolean;
}

export interface CartLine {
  productId: string;
  sku: string;
  name: string;
  pricePaise: number;
  imageUrl: string | null;
  stock: number;
  quantity: number;
  lineTotalPaise: number;
}

export interface Cart {
  items: CartLine[];
  subtotalPaise: number;
  totalQuantity: number;
}

export interface Quote {
  subtotalPaise: number;
  shippingPaise: number;
  discountPaise: number;
  creditAvailablePaise: number;
  creditToUsePaise: number;
  totalPaise: number;
  payablePaise: number;
}

export interface CreditEntry {
  id: string;
  type: 'CREDIT' | 'DEBIT' | 'ADJUSTMENT';
  amountPaise: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
}

export interface CreditState {
  balancePaise: number;
  history: CreditEntry[];
}

export interface OrderTrackingEvent {
  id: string;
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
  events: OrderTrackingEvent[];
}
