import { HttpError } from '../middleware/error.js';

/**
 * Admin permission registry.
 *
 * Single-ADMIN-role phase: every string below is recognised, but the check
 * itself is role-based (see hasPermission). When granular RBAC lands, only
 * hasPermission's body changes — every requireAdmin('...') call site keeps
 * working. Unknown strings fail closed and loud at request time so a typo
 * can never silently open an endpoint.
 */
export const ADMIN_PERMISSIONS = [
  'ADMIN_DASHBOARD_VIEW',
  'CUSTOMER_VIEW',
  'CUSTOMER_MANAGE',
  'ORDER_VIEW',
  'ORDER_MANAGE',
  'RETURN_VIEW',
  'RETURN_MANAGE',
  'REFUND_VIEW',
  'REFUND_MANAGE',
  'STORE_CREDIT_VIEW',
  'STORE_CREDIT_MANAGE',
  'PRODUCT_VIEW',
  'PRODUCT_MANAGE',
  'INVENTORY_VIEW',
  'INVENTORY_MANAGE',
  'WAREHOUSE_VIEW',
  'WAREHOUSE_MANAGE',
  'SUPPORT_VIEW',
  'SUPPORT_MANAGE',
  'USER_MANAGE',
  'ANALYTICS_VIEW',
  'AUDIT_VIEW',
  'SETTINGS_MANAGE',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/** Whether `role` currently grants `permission`. RBAC joins go here later. */
export function hasPermission(role: string, permission: AdminPermission): boolean {
  if (!ADMIN_PERMISSIONS.includes(permission)) {
    throw new HttpError(500, 'PERMISSION_NOT_REGISTERED', `Unknown admin permission: ${permission}`);
  }
  return role === 'ADMIN';
}
