import Database from 'better-sqlite3';
import { config } from './config.js';
import { seedSettings } from './admin/settings.js';
import { initAdminSchema } from './admin/schema.js';
import { initWarehouseSchema } from './warehouse/schema.js';

// Single shared better-sqlite3 connection. The driver is synchronous, so all
// repository functions in store.ts run against this handle.
export const db = new Database(config.databasePath);

const REASON_SEED: Array<{ code: string; label: string; description: string }> = [
  { code: 'WRONG_ITEM', label: 'Wrong item received', description: 'The delivered product does not match the ordered product.' },
  { code: 'DAMAGED', label: 'Damaged in transit', description: 'The product arrived physically damaged.' },
  { code: 'DEFECTIVE', label: 'Defective product', description: 'The product has a manufacturing defect or does not work.' },
  { code: 'SIZE_ISSUE', label: 'Size or fit issue', description: 'The product size or fit is not suitable.' },
  { code: 'QUALITY_ISSUE', label: 'Quality issue', description: 'The product quality is below expectations.' },
  { code: 'CHANGED_MIND', label: 'Changed mind', description: 'The customer no longer wants the product.' },
  { code: 'NOT_AS_DESCRIBED', label: 'Not as described', description: 'The product differs from its description or images.' },
  { code: 'OTHER', label: 'Other', description: 'Any other reason not listed here.' },
];

/** Create every table, index, and seed row required by the platform. */
export function initSchema(): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'CUSTOMER',
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      phone TEXT NULL,
      comm_prefs TEXT NOT NULL DEFAULT '{}',
      notif_prefs TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS addresses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NULL,
      full_name TEXT NOT NULL,
      line1 TEXT NOT NULL,
      line2 TEXT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'IN',
      phone TEXT NULL,
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT UNIQUE NOT NULL,
      customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      subtotal REAL NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity >= 1),
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS return_reasons (
      code TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS returns (
      id TEXT PRIMARY KEY,
      return_number TEXT UNIQUE NOT NULL,
      order_id TEXT NOT NULL REFERENCES orders(id),
      customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      resolution_type TEXT NULL,
      description TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      cancelled_at TEXT NULL,
      cancel_reason TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS return_items (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
      order_item_id TEXT NOT NULL REFERENCES order_items(id),
      quantity INTEGER NOT NULL CHECK (quantity >= 1),
      reason_code TEXT NOT NULL REFERENCES return_reasons(code),
      description TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS return_events (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      description TEXT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pickups (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL UNIQUE REFERENCES returns(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('PICKUP', 'DROP_OFF')),
      address TEXT NULL,
      date TEXT NULL,
      time_window TEXT NULL,
      carrier TEXT NULL,
      tracking_number TEXT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS refunds (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL UNIQUE REFERENCES returns(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('REFUND', 'REPLACEMENT', 'EXCHANGE', 'STORE_CREDIT')),
      amount REAL NULL,
      method TEXT NULL,
      status TEXT NOT NULL,
      initiated_at TEXT NULL,
      completed_at TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      return_id TEXT NULL REFERENCES returns(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      ticket_number TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      return_id TEXT NULL REFERENCES returns(id) ON DELETE SET NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      priority TEXT NOT NULL DEFAULT 'NORMAL',
      assigned_to TEXT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS support_messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      author_role TEXT NOT NULL CHECK (author_role IN ('CUSTOMER', 'SYSTEM')),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL UNIQUE REFERENCES returns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      comment TEXT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS return_counter (
      year TEXT PRIMARY KEY,
      last_seq INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ticket_counter (
      year TEXT PRIMARY KEY,
      last_seq INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
    CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id);
    CREATE INDEX IF NOT EXISTS idx_returns_customer ON returns(customer_id);
    CREATE INDEX IF NOT EXISTS idx_return_items_return ON return_items(return_id);
    CREATE INDEX IF NOT EXISTS idx_return_items_order_item ON return_items(order_item_id);
    CREATE INDEX IF NOT EXISTS idx_return_events_return ON return_events(return_id);
    CREATE INDEX IF NOT EXISTS idx_pickups_return ON pickups(return_id);
    CREATE INDEX IF NOT EXISTS idx_refunds_return ON refunds(return_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_return ON notifications(return_id);
    CREATE INDEX IF NOT EXISTS idx_documents_return ON documents(return_id);
    CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets(user_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_return ON support_tickets(return_id);
    CREATE INDEX IF NOT EXISTS idx_messages_ticket ON support_messages(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_return ON feedback(return_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
  `);

  // Commerce tables for the storefront (products, cart, order timeline,
  // store-credit ledger, checkout idempotency, order numbering).
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      sku TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      price_paise INTEGER NOT NULL DEFAULT 0,
      image_url TEXT NOT NULL DEFAULT '',
      stock INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      category_id TEXT NULL REFERENCES categories(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cart_items (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL CHECK (quantity >= 1),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS order_events (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      description TEXT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_credit_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('CREDIT', 'DEBIT', 'ADJUSTMENT')),
      amount_paise INTEGER NOT NULL,
      reason TEXT NULL,
      reference_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (reference_type, reference_id)
    );

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_counter (
      year TEXT PRIMARY KEY,
      last_seq INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
    CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON store_credit_ledger(user_id, created_at);
  `);

  // Add new columns to legacy tables only when they are missing, so existing
  // developer databases migrate safely on boot.
  const existingOrderColumns = new Set(
    (db.prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>).map((col) => col.name),
  );
  const orderAdditions: string[] = [
    'ADD COLUMN shipping_address TEXT NULL',
    "ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'UNPAID'",
    'ADD COLUMN payment_method TEXT NULL',
    'ADD COLUMN carrier TEXT NULL',
    'ADD COLUMN tracking_number TEXT NULL',
    "ADD COLUMN kind TEXT NOT NULL DEFAULT 'STANDARD'",
    'ADD COLUMN source_return_id TEXT NULL REFERENCES returns(id)',
    'ADD COLUMN credit_used_paise INTEGER NOT NULL DEFAULT 0',
    'ADD COLUMN shipping_paise INTEGER NOT NULL DEFAULT 0',
    'ADD COLUMN discount_paise INTEGER NOT NULL DEFAULT 0',
    'ADD COLUMN estimated_delivery TEXT NULL',
    'ADD COLUMN subtotal_paise INTEGER NOT NULL DEFAULT 0',
  ];
  for (const addition of orderAdditions) {
    const columnName = addition.split(' ')[2] ?? '';
    if (!existingOrderColumns.has(columnName)) {
      db.exec(`ALTER TABLE orders ${addition}`);
    }
  }

  const existingItemColumns = new Set(
    (db.prepare('PRAGMA table_info(order_items)').all() as Array<{ name: string }>).map((col) => col.name),
  );
  const itemAdditions: string[] = [
    'ADD COLUMN product_image_url TEXT NULL',
    'ADD COLUMN unit_price_paise INTEGER NOT NULL DEFAULT 0',
    'ADD COLUMN line_total_paise INTEGER NOT NULL DEFAULT 0',
  ];
  for (const addition of itemAdditions) {
    const columnName = addition.split(' ')[2] ?? '';
    if (!existingItemColumns.has(columnName)) {
      db.exec(`ALTER TABLE order_items ${addition}`);
    }
  }

  const existingRefundColumns = new Set(
    (db.prepare('PRAGMA table_info(refunds)').all() as Array<{ name: string }>).map((col) => col.name),
  );
  if (!existingRefundColumns.has('amount_paise')) {
    db.exec('ALTER TABLE refunds ADD COLUMN amount_paise INTEGER NOT NULL DEFAULT 0');
  }

  const existingReasonColumns = new Set(
    (db.prepare('PRAGMA table_info(return_reasons)').all() as Array<{ name: string }>).map((col) => col.name),
  );
  if (!existingReasonColumns.has('sort_order')) {
    db.exec('ALTER TABLE return_reasons ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
  }

  const existingUserColumns = new Set(
    (db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map((col) => col.name),
  );
  if (!existingUserColumns.has('active')) {
    db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))');
  }

  const existingTicketColumns = new Set(
    (db.prepare('PRAGMA table_info(support_tickets)').all() as Array<{ name: string }>).map((col) => col.name),
  );
  if (!existingTicketColumns.has('priority')) {
    db.exec("ALTER TABLE support_tickets ADD COLUMN priority TEXT NOT NULL DEFAULT 'NORMAL'");
  }
  if (!existingTicketColumns.has('assigned_to')) {
    db.exec('ALTER TABLE support_tickets ADD COLUMN assigned_to TEXT NULL REFERENCES users(id)');
  }

  const existingProductColumns = new Set(
    (db.prepare('PRAGMA table_info(products)').all() as Array<{ name: string }>).map((col) => col.name),
  );
  if (!existingProductColumns.has('category_id')) {
    db.exec('ALTER TABLE products ADD COLUMN category_id TEXT NULL REFERENCES categories(id)');
  }

  // Backfill the integer-paise columns from the legacy REAL rupee columns once,
  // so existing developer databases gain an exact money source of truth.
  // ROUND() happens in SQLite before the cast, so 1299.99 -> 129999, not 129998.
  db.exec(`
    UPDATE orders SET subtotal_paise = CAST(ROUND(subtotal * 100) AS INTEGER)
      WHERE subtotal_paise = 0 AND subtotal > 0;
    UPDATE order_items SET unit_price_paise = CAST(ROUND(unit_price * 100) AS INTEGER)
      WHERE unit_price_paise = 0 AND unit_price > 0;
    UPDATE order_items SET line_total_paise = CAST(ROUND(line_total * 100) AS INTEGER)
      WHERE line_total_paise = 0 AND line_total > 0;
    UPDATE refunds SET amount_paise = CAST(ROUND(amount * 100) AS INTEGER)
      WHERE amount_paise = 0 AND amount > 0;
  `);

  // Warehouse operations tables live in their own module but share this pass,
  // so one initSchema() call still produces a complete database.
  initWarehouseSchema();

  // Admin audit trail. Same pass, same guarantees; read paths only.
  initAdminSchema();

  const seedReason = db.prepare(
    'INSERT OR IGNORE INTO return_reasons (code, label, description, active) VALUES (?, ?, ?, 1)',
  );
  const seedAll = db.transaction(() => {
    for (const reason of REASON_SEED) {
      seedReason.run(reason.code, reason.label, reason.description);
    }
  });
  seedAll();

  // Operational parameters seed from compiled defaults on every boot.
  // INSERT OR IGNORE: admin-customised rows are never overwritten, and the
  // return window honours the environment the first time it is seeded.
  seedSettings({ RETURN_WINDOW_DAYS: config.returnWindowDays });
}
