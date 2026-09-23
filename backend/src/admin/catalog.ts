import { db } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { id, nowIso } from '../utils.js';
import { DEFAULT_WAREHOUSE_ID } from '../warehouse/schema.js';
import { auditAdminWrite } from './audit.js';

/**
 * Admin catalogue management: categories and products.
 *
 * Every mutation below runs inside one transaction that also stamps
 * admin_audit_log with before/after snapshots (the auditAdminWrite pattern
 * all later admin writes copy). Guards refuse destructive intent with
 * explicit 409s instead of silently breaking live transactions:
 * - a category with products cannot be deleted (nothing is orphaned);
 * - a product with open orders or open returns cannot be disabled.
 */

export interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface CategoryWithCount extends CategoryRow {
  product_count: number;
}

export interface AdminProductRow {
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
}

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

function loadCategory(categoryId: string): CategoryRow {
  const row = asSingle<CategoryRow>(db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId));
  if (row === undefined) {
    throw new HttpError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
  }
  return row;
}

function loadProduct(productId: string): AdminProductRow {
  const row = asSingle<AdminProductRow>(
    db.prepare(
      `SELECT p.*, c.name AS category_name FROM products p
        LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`,
    ).get(productId),
  );
  if (row === undefined) {
    throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  }
  return row;
}

/** Active category required for assignment; disabled ones stay historical. */
function requireActiveCategory(categoryId: string): CategoryRow {
  const category = loadCategory(categoryId);
  if (category.active !== 1) {
    throw new HttpError(422, 'CATEGORY_INACTIVE', `Category "${category.name}" is disabled and cannot take new products`);
  }
  return category;
}

/** Mirror a stock set into the default dock's AVAILABLE bucket in-transaction. */
function mirrorStock(productId: string, stock: number, now: string): void {
  db.prepare(
    `INSERT INTO inventory_buckets (warehouse_id, product_id, state, quantity, location_id, updated_at)
     VALUES (?, ?, 'AVAILABLE', ?, NULL, ?)
     ON CONFLICT(warehouse_id, product_id, state) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at`,
  ).run(DEFAULT_WAREHOUSE_ID, productId, stock, now);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/** Categories with live product counts, in display order. */
export function listCategoriesAdmin(): { categories: CategoryWithCount[] } {
  const categories = asMany<CategoryWithCount>(
    db.prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
         FROM categories c ORDER BY c.sort_order ASC, c.name ASC`,
    ).all(),
  );
  return { categories };
}

/** One category with its products. */
export function getCategoryAdmin(categoryId: string): {
  category: CategoryRow;
  products: Array<{ id: string; sku: string; name: string; active: number }>;
} {
  const category = loadCategory(categoryId);
  const products = asMany<{ id: string; sku: string; name: string; active: number }>(
    db.prepare('SELECT id, sku, name, active FROM products WHERE category_id = ? ORDER BY name ASC').all(categoryId),
  );
  return { category, products };
}

export interface CategoryCreateInput {
  name: string;
  description?: string | null;
  sortOrder?: number;
  active?: boolean;
}

export const createCategory = db.transaction(
  (actor: Actor, input: CategoryCreateInput): CategoryRow => {
    const name = input.name.trim();
    if (name.length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Category name is required');
    }
    const clash = asSingle<{ id: string }>(db.prepare('SELECT id FROM categories WHERE name = ?').get(name));
    if (clash !== undefined) {
      throw new HttpError(409, 'CATEGORY_NAME_EXISTS', `A category named "${name}" already exists`);
    }
    const now = nowIso();
    const row: CategoryRow = {
      id: id(),
      name,
      description: input.description?.trim() === '' || input.description == null ? null : input.description.trim(),
      sort_order: input.sortOrder ?? 0,
      active: input.active === false ? 0 : 1,
      created_at: now,
      updated_at: now,
    };
    db.prepare(
      'INSERT INTO categories (id, name, description, sort_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(row.id, row.name, row.description, row.sort_order, row.active, row.created_at, row.updated_at);
    auditAdminWrite({
      actorId: actor.id, action: 'CATEGORY_CREATED', entityType: 'CATEGORY', entityId: row.id,
      before: null, after: row, ip: actor.ip,
    });
    return row;
  },
);

export interface CategoryPatch {
  name?: string;
  description?: string | null;
  sortOrder?: number;
  active?: boolean;
}

export const updateCategory = db.transaction(
  (actor: Actor, categoryId: string, patch: CategoryPatch): CategoryRow => {
    const before = loadCategory(categoryId);
    let { name, description, sort_order: sortOrder, active } = before;
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (trimmed.length === 0) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Category name is required');
      }
      const clash = asSingle<{ id: string }>(
        db.prepare('SELECT id FROM categories WHERE name = ? AND id != ?').get(trimmed, categoryId),
      );
      if (clash !== undefined) {
        throw new HttpError(409, 'CATEGORY_NAME_EXISTS', `A category named "${trimmed}" already exists`);
      }
      name = trimmed;
    }
    if (patch.description !== undefined) {
      description = patch.description?.trim() === '' || patch.description == null ? null : patch.description.trim();
    }
    if (patch.sortOrder !== undefined) {
      sortOrder = patch.sortOrder;
    }
    if (patch.active !== undefined) {
      active = patch.active ? 1 : 0;
    }
    const now = nowIso();
    db.prepare('UPDATE categories SET name = ?, description = ?, sort_order = ?, active = ?, updated_at = ? WHERE id = ?').run(
      name, description, sortOrder, active, now, categoryId,
    );
    const after = loadCategory(categoryId);
    auditAdminWrite({
      actorId: actor.id, action: 'CATEGORY_UPDATED', entityType: 'CATEGORY', entityId: categoryId,
      before, after, ip: actor.ip,
    });
    return after;
  },
);

export const deleteCategory = db.transaction((actor: Actor, categoryId: string): void => {
  const before = loadCategory(categoryId);
  const users = asMany<{ sku: string }>(
    db.prepare('SELECT sku FROM products WHERE category_id = ? ORDER BY sku ASC LIMIT 6').all(categoryId),
  );
  const countRow = asSingle<{ count: number }>(
    db.prepare('SELECT COUNT(*) AS count FROM products WHERE category_id = ?').get(categoryId),
  );
  const count = countRow?.count ?? 0;
  if (count > 0) {
    throw new HttpError(
      409,
      'CATEGORY_IN_USE',
      `Category "${before.name}" still holds ${count} product(s) and cannot be deleted`,
      { count, skus: users.map((row) => row.sku) },
    );
  }
  db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
  auditAdminWrite({
    actorId: actor.id, action: 'CATEGORY_DELETED', entityType: 'CATEGORY', entityId: categoryId,
    before, after: null, ip: actor.ip,
  });
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface ProductListQuery {
  search?: string;
  active?: boolean;
  categoryId?: string;
  sort: string;
  dir: 'ASC' | 'DESC';
  limit: number;
  offset: number;
}

const PRODUCT_SORTS: Record<string, string> = {
  name: 'p.name',
  price: 'p.price_paise',
  stock: 'p.stock',
  created_at: 'p.created_at',
  sku: 'p.sku',
};

export interface AdminProductListRow extends AdminProductRow {
  open_orders: number;
  open_returns: number;
}

/** Catalogue with category names and live in-flight counts per row. */
export function listProductsAdmin(query: ProductListQuery): { products: AdminProductListRow[]; total: number } {
  const filters: string[] = [];
  const params: unknown[] = [];
  if (query.search !== undefined && query.search.trim() !== '') {
    const term = `%${query.search.trim().toLowerCase()}%`;
    filters.push('(LOWER(p.sku) LIKE ? OR LOWER(p.name) LIKE ?)');
    params.push(term, term);
  }
  if (query.active !== undefined) {
    filters.push('p.active = ?');
    params.push(query.active ? 1 : 0);
  }
  if (query.categoryId !== undefined && query.categoryId !== '') {
    filters.push('p.category_id = ?');
    params.push(query.categoryId);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const orderBy = PRODUCT_SORTS[query.sort] ?? PRODUCT_SORTS.name;

  const total = asSingle<{ count: number }>(
    db.prepare(`SELECT COUNT(*) AS count FROM products p ${where}`).get(...params),
  )?.count ?? 0;

  const products = asMany<AdminProductListRow>(
    db.prepare(
      `SELECT p.*, c.name AS category_name,
              (SELECT COUNT(DISTINCT o.id) FROM orders o JOIN order_items oi ON oi.order_id = o.id
                WHERE oi.product_id = p.id AND o.status NOT IN ('DELIVERED', 'CANCELLED')) AS open_orders,
              (SELECT COUNT(DISTINCT r.id) FROM returns r
                 JOIN return_items ri ON ri.return_id = r.id
                 JOIN order_items oi ON oi.id = ri.order_item_id
                WHERE oi.product_id = p.id AND r.status NOT IN ('RESOLVED', 'CANCELLED', 'REJECTED')) AS open_returns
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
        ${where} ORDER BY ${orderBy} ${query.dir} LIMIT ? OFFSET ?`,
    ).all(...params, query.limit, query.offset),
  );
  return { products, total };
}

export interface AdminProductDetail {
  product: AdminProductRow;
  buckets: Array<{ warehouse_id: string; state: string; quantity: number }>;
  movements: Array<{ id: string; reason: string; quantity: number; from_state: string | null; to_state: string | null; created_at: string }>;
  openOrders: Array<{ order_number: string; status: string }>;
  openReturns: Array<{ return_number: string; status: string }>;
}

/** One product with stock distribution and in-flight transactions. */
export function getProductAdmin(productId: string): AdminProductDetail {
  const product = loadProduct(productId);
  return {
    product,
    buckets: asMany(
      db.prepare('SELECT warehouse_id, state, quantity FROM inventory_buckets WHERE product_id = ? ORDER BY state ASC').all(productId),
    ),
    movements: asMany(
      db.prepare(
        'SELECT id, reason, quantity, from_state, to_state, created_at FROM inventory_movements WHERE product_id = ? ORDER BY created_at DESC, id DESC LIMIT 10',
      ).all(productId),
    ),
    openOrders: asMany(
      db.prepare(
        `SELECT DISTINCT o.order_number, o.status FROM orders o JOIN order_items oi ON oi.order_id = o.id
          WHERE oi.product_id = ? AND o.status NOT IN ('DELIVERED', 'CANCELLED') ORDER BY o.created_at DESC LIMIT 5`,
      ).all(productId),
    ),
    openReturns: asMany(
      db.prepare(
        `SELECT DISTINCT r.return_number, r.status FROM returns r
           JOIN return_items ri ON ri.return_id = r.id
           JOIN order_items oi ON oi.id = ri.order_item_id
          WHERE oi.product_id = ? AND r.status NOT IN ('RESOLVED', 'CANCELLED', 'REJECTED')
          ORDER BY r.created_at DESC LIMIT 5`,
      ).all(productId),
    ),
  };
}

export interface ProductCreateInput {
  sku: string;
  name: string;
  description?: string;
  details?: string;
  pricePaise: number;
  imageUrl?: string;
  stock: number;
  categoryId?: string | null;
  active?: boolean;
}

export const createProduct = db.transaction(
  (actor: Actor, input: ProductCreateInput): AdminProductRow => {
    const sku = input.sku.trim();
    const name = input.name.trim();
    if (sku.length === 0 || name.length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'SKU and name are required');
    }
    if (!Number.isInteger(input.pricePaise) || input.pricePaise < 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Price must be a non-negative integer number of paise');
    }
    if (!Number.isInteger(input.stock) || input.stock < 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Stock must be a non-negative integer');
    }
    if (db.prepare('SELECT id FROM products WHERE sku = ?').get(sku) !== undefined) {
      throw new HttpError(409, 'PRODUCT_SKU_EXISTS', `A product with SKU "${sku}" already exists`);
    }
    if (input.categoryId !== undefined && input.categoryId !== null && input.categoryId !== '') {
      requireActiveCategory(input.categoryId);
    }
    const now = nowIso();
    const row: AdminProductRow = {
      id: id(),
      sku,
      name,
      description: input.description ?? '',
      details: input.details ?? '',
      price_paise: input.pricePaise,
      image_url: input.imageUrl ?? '',
      stock: input.stock,
      active: input.active === false ? 0 : 1,
      category_id: input.categoryId ?? null,
      category_name: null,
      created_at: now,
      updated_at: now,
    };
    db.prepare(
      `INSERT INTO products (id, sku, name, description, details, price_paise, image_url, stock, active, category_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id, row.sku, row.name, row.description, row.details, row.price_paise,
      row.image_url, row.stock, row.active, row.category_id, row.created_at, row.updated_at,
    );
    // A new product starts with its sellable mirror in step.
    mirrorStock(row.id, row.stock, now);
    const after = loadProduct(row.id);
    auditAdminWrite({
      actorId: actor.id, action: 'PRODUCT_CREATED', entityType: 'PRODUCT', entityId: row.id,
      before: null, after, ip: actor.ip,
    });
    return after;
  },
);

export interface ProductPatch {
  name?: string;
  description?: string;
  details?: string;
  imageUrl?: string;
  pricePaise?: number;
  stock?: number;
  categoryId?: string | null;
  active?: boolean;
}

/** In-flight transactions blocking a disable, named explicitly. */
export function productBlockers(productId: string): {
  openOrders: number;
  openReturns: number;
  orderNumbers: string[];
  returnNumbers: string[];
} {
  const orders = asMany<{ order_number: string }>(
    db.prepare(
      `SELECT DISTINCT o.order_number FROM orders o JOIN order_items oi ON oi.order_id = o.id
        WHERE oi.product_id = ? AND o.status NOT IN ('DELIVERED', 'CANCELLED')
        ORDER BY o.created_at DESC LIMIT 5`,
    ).all(productId),
  );
  const returns = asMany<{ return_number: string }>(
    db.prepare(
      `SELECT DISTINCT r.return_number FROM returns r
         JOIN return_items ri ON ri.return_id = r.id
         JOIN order_items oi ON oi.id = ri.order_item_id
        WHERE oi.product_id = ? AND r.status NOT IN ('RESOLVED', 'CANCELLED', 'REJECTED')
        ORDER BY r.created_at DESC LIMIT 5`,
    ).all(productId),
  );
  const openOrders = asSingle<{ count: number }>(
    db.prepare(
      `SELECT COUNT(DISTINCT o.id) AS count FROM orders o JOIN order_items oi ON oi.order_id = o.id
        WHERE oi.product_id = ? AND o.status NOT IN ('DELIVERED', 'CANCELLED')`,
    ).get(productId),
  )?.count ?? 0;
  const openReturns = asSingle<{ count: number }>(
    db.prepare(
      `SELECT COUNT(DISTINCT r.id) AS count FROM returns r
         JOIN return_items ri ON ri.return_id = r.id
         JOIN order_items oi ON oi.id = ri.order_item_id
        WHERE oi.product_id = ? AND r.status NOT IN ('RESOLVED', 'CANCELLED', 'REJECTED')`,
    ).get(productId),
  )?.count ?? 0;
  return {
    openOrders,
    openReturns,
    orderNumbers: orders.map((row) => row.order_number),
    returnNumbers: returns.map((row) => row.return_number),
  };
}

export const updateProduct = db.transaction(
  (actor: Actor, productId: string, patch: ProductPatch): AdminProductRow => {
    const before = loadProduct(productId);
    let name = before.name;
    let description = before.description;
    let details = before.details;
    let imageUrl = before.image_url;
    let pricePaise = before.price_paise;
    let stock = before.stock;
    let categoryId = before.category_id;
    let active = before.active;

    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (trimmed.length === 0) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Product name is required');
      }
      name = trimmed;
    }
    if (patch.description !== undefined) description = patch.description;
    if (patch.details !== undefined) details = patch.details;
    if (patch.imageUrl !== undefined) imageUrl = patch.imageUrl;
    if (patch.pricePaise !== undefined) {
      if (!Number.isInteger(patch.pricePaise) || patch.pricePaise < 0) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Price must be a non-negative integer number of paise');
      }
      pricePaise = patch.pricePaise;
    }
    if (patch.stock !== undefined) {
      if (!Number.isInteger(patch.stock) || patch.stock < 0) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Stock must be a non-negative integer');
      }
      stock = patch.stock;
    }
    if (patch.categoryId !== undefined) {
      if (patch.categoryId === null || patch.categoryId === '') {
        categoryId = null;
      } else {
        requireActiveCategory(patch.categoryId);
        categoryId = patch.categoryId;
      }
    }
    if (patch.active !== undefined) {
      if (patch.active === false && before.active === 1) {
        // Disabling hides the product from future sales: refuse while live
        // transactions reference it, and say exactly what is in flight.
        const blockers = productBlockers(productId);
        if (blockers.openOrders > 0 || blockers.openReturns > 0) {
          throw new HttpError(
            409,
            'PRODUCT_HAS_PENDING_TRANSACTIONS',
            `Product "${before.sku}" has ${blockers.openOrders} open order(s) and ${blockers.openReturns} open return(s) and cannot be disabled`,
            {
              openOrders: blockers.openOrders,
              openReturns: blockers.openReturns,
              orderNumbers: blockers.orderNumbers,
              returnNumbers: blockers.returnNumbers,
            },
          );
        }
        active = 0;
      } else if (patch.active === true) {
        active = 1;
      }
    }

    const now = nowIso();
    db.prepare(
      `UPDATE products SET name = ?, description = ?, details = ?, image_url = ?, price_paise = ?,
        stock = ?, category_id = ?, active = ?, updated_at = ? WHERE id = ?`,
    ).run(name, description, details, imageUrl, pricePaise, stock, categoryId, active, now, productId);
    if (patch.stock !== undefined) {
      mirrorStock(productId, stock, now);
    }
    const after = loadProduct(productId);
    auditAdminWrite({
      actorId: actor.id, action: 'PRODUCT_UPDATED', entityType: 'PRODUCT', entityId: productId,
      before, after, ip: actor.ip,
    });
    return after;
  },
);
