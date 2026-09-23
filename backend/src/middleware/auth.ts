import type { NextFunction, Request, Response } from 'express';
import { db } from '../db.js';
import { verifyToken } from '../utils.js';
import { HttpError } from './error.js';
import { hasPermission } from '../admin/permissions.js';
import type { AdminPermission } from '../admin/permissions.js';

/** Authenticated principal attached to every authorized request. */
export interface AuthUser {
  id: string;
  email: string;
  role: string;
  /** Site a warehouse operator is scoped to. Null for customers. */
  warehouseId?: string | null;
}

declare global {
  // Augment the Express request type with the authenticated principal.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Require a valid Bearer JWT and attach the principal to the request. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) {
    next(new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid authorization header'));
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  if (token.length === 0) {
    next(new HttpError(401, 'UNAUTHORIZED', 'Missing access token'));
    return;
  }
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
  } catch {
    next(new HttpError(401, 'UNAUTHORIZED', 'Invalid or expired access token'));
    return;
  }
  // Disabled accounts stop here no matter what their token says. The lookup
  // is per-request (same pattern as the warehouse scope below) so disabling
  // takes effect immediately instead of at JWT expiry.
  const row = db.prepare('SELECT active FROM users WHERE id = ?').get(req.user.id) as
    | { active: number }
    | undefined;
  if (row === undefined || row.active !== 1) {
    next(new HttpError(403, 'ACCOUNT_DISABLED', 'This account has been disabled'));
    return;
  }
  next();
  void _res;
}

/**
 * Require the WAREHOUSE role, and attach the operator's warehouse scope.
 *
 * The scope is read from the database rather than the token so that revoking
 * or moving an operator takes effect immediately instead of when their JWT
 * expires. Every warehouse query filters on `req.user.warehouseId`, which is
 * what keeps one site's operational data out of another's.
 */
export function requireWarehouse(req: Request, _res: Response, next: NextFunction): void {
  if (req.user === undefined) {
    next(new HttpError(401, 'UNAUTHORIZED', 'Authentication required'));
    return;
  }
  if (req.user.role !== 'WAREHOUSE') {
    next(new HttpError(403, 'FORBIDDEN', 'Warehouse access required'));
    return;
  }
  const row = db.prepare('SELECT warehouse_id FROM users WHERE id = ?').get(req.user.id) as
    | { warehouse_id: string | null }
    | undefined;
  if (row?.warehouse_id === null || row?.warehouse_id === undefined) {
    next(new HttpError(403, 'NO_WAREHOUSE_ASSIGNED', 'This account is not assigned to a warehouse'));
    return;
  }
  const site = db.prepare('SELECT active FROM warehouses WHERE id = ?').get(row.warehouse_id) as
    | { active: number }
    | undefined;
  if (site === undefined || site.active !== 1) {
    next(new HttpError(403, 'WAREHOUSE_DISABLED', 'This warehouse has been disabled'));
    return;
  }
  req.user.warehouseId = row.warehouse_id;
  next();
  void _res;
}

/**
 * The warehouse an operator may act on. Routes call this instead of reading
 * the request directly, so a missing scope fails loudly rather than widening
 * a query to every site.
 */
export function requireWarehouseId(req: Request): string {
  const warehouseId = req.user?.warehouseId;
  if (warehouseId === null || warehouseId === undefined || warehouseId === '') {
    throw new HttpError(403, 'NO_WAREHOUSE_ASSIGNED', 'This account is not assigned to a warehouse');
  }
  return warehouseId;
}

/** Require the authenticated principal to hold the CUSTOMER role. */
export function requireCustomer(req: Request, _res: Response, next: NextFunction): void {
  if (req.user === undefined) {
    next(new HttpError(401, 'UNAUTHORIZED', 'Authentication required'));
    return;
  }
  if (req.user.role !== 'CUSTOMER') {
    next(new HttpError(403, 'FORBIDDEN', 'Customer access required'));
    return;
  }
  next();
  void _res;
}

/**
 * Require the ADMIN role, optionally narrowed to one permission string.
 *
 * The role is read from the database on every request (same pattern as
 * requireWarehouse), so demoting an admin takes effect immediately instead
 * of at JWT expiry. The optional permission argument is checked through the
 * registry: today it passes for role ADMIN, and granular RBAC slots into
 * hasPermission later without touching any call site. Unknown permission
 * strings fail closed via hasPermission.
 */
export function requireAdmin(permission?: AdminPermission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.user === undefined) {
      next(new HttpError(401, 'UNAUTHORIZED', 'Authentication required'));
      return;
    }
    const row = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id) as
      | { role: string }
      | undefined;
    if (row === undefined || row.role !== 'ADMIN') {
      next(new HttpError(403, 'ADMIN_REQUIRED', 'Admin access required'));
      return;
    }
    if (permission !== undefined && !hasPermission(row.role, permission)) {
      next(new HttpError(403, 'PERMISSION_DENIED', `Permission required: ${permission}`));
      return;
    }
    next();
    void _res;
  };
}
