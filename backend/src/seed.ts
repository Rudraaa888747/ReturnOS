import bcrypt from 'bcryptjs';
import { db, initSchema } from './db.js';
import { seedTemplates } from './admin/notifications.js';
import { createNotification, createOrder } from './store.js';
import { DEFAULT_WAREHOUSE_ID } from './warehouse/schema.js';
import { syncAvailableBuckets } from './warehouse/inventory.js';

const DEMO_USER_ID = 'u-demo-rudra';
const MAYA_USER_ID = 'u-demo-maya';
const WAREHOUSE_USER_ID = 'u-wh-operator';
const ADMIN_USER_ID = 'u-admin';

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function nowIsoSeed(): string {
  return new Date().toISOString();
}

/**
 * Storefront catalogue. Prices are held in integer paise and this table is the
 * single source of truth for them: order lines snapshot these values at
 * purchase time, so changing a price here never rewrites order history.
 */
interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
  description: string;
  details: string;
  pricePaise: number;
  imageUrl: string;
  stock: number;
}

export const CATALOG: readonly CatalogProduct[] = [
  {
    id: 'p-airmax',
    sku: 'AIRMAX-90-UK9',
    name: 'Air Max Runner',
    description: 'Cushioned road-running shoe with a visible air unit and breathable mesh upper.',
    details: 'Engineered mesh upper · Foam midsole with visible air unit · Rubber waffle outsole · UK 9 · 289g',
    pricePaise: 1_299_500,
    imageUrl: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&q=80&auto=format&fit=crop',
    stock: 24,
  },
  {
    id: 'p-trail',
    sku: 'TRAIL-GTX-UK9',
    name: 'Trail Hiking Shoes',
    description: 'Waterproof trail shoe built for loose rock and wet ground.',
    details: 'Waterproof membrane · 5mm lugged outsole · Reinforced toe cap · UK 9 · 412g',
    pricePaise: 849_900,
    imageUrl: 'https://images.unsplash.com/photo-1520639888713-7851133b1ed0?w=800&q=80&auto=format&fit=crop',
    stock: 30,
  },
  {
    id: 'p-denim',
    sku: 'DENIM-SLIM-32',
    name: 'Slim Denim Jeans',
    description: 'Mid-rise slim jeans in comfort stretch denim with a clean indigo finish.',
    details: '98% cotton, 2% elastane · Five-pocket · Button fly · 32" waist, 32" inseam · Machine wash cold',
    pricePaise: 329_900,
    imageUrl: 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=800&q=80&auto=format&fit=crop',
    stock: 50,
  },
  {
    id: 'p-aurora',
    sku: 'AURORA-SCARF-180',
    name: 'Aurora Wool Scarf',
    description: 'Brushed lambswool-blend scarf, light enough to layer and warm enough for winter.',
    details: '70% lambswool, 30% recycled polyamide · 180 x 32 cm · Hand-finished fringe · Dry clean only',
    pricePaise: 249_900,
    imageUrl: 'https://images.unsplash.com/photo-1737056207688-acc991990309?w=800&q=80&auto=format&fit=crop',
    stock: 40,
  },
  {
    id: 'p-tee',
    sku: 'TEE-CORE-WHT-M',
    name: 'Essential Cotton Tee',
    description: 'Heavyweight combed-cotton t-shirt with a clean regular fit that holds its shape.',
    details: '100% combed cotton, 220 GSM · Regular fit · Ribbed collar · Size M · Machine wash warm',
    pricePaise: 129_900,
    imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80&auto=format&fit=crop',
    stock: 100,
  },
];

/** Look a catalogue product up by id; seeded orders are built from these rows. */
function product(id: string): CatalogProduct {
  const found = CATALOG.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`Unknown catalogue product: ${id}`);
  }
  return found;
}

/** Rupee unit price for a catalogue product, as createOrder takes it. */
function unitPrice(id: string): number {
  return product(id).pricePaise / 100;
}

/**
 * Insert the catalogue, and keep descriptive fields and pricing in step with
 * this file on later runs. Stock is deliberately left alone: it moves with real
 * orders and returns, so re-seeding must not silently restock the warehouse.
 */
function seedCatalog(): void {
  const now = nowIsoSeed();
  const upsert = db.prepare(
    `INSERT INTO products (id, sku, name, description, details, price_paise, image_url, stock, active, created_at, updated_at)
     VALUES (@id, @sku, @name, @description, @details, @pricePaise, @imageUrl, @stock, 1, @now, @now)
     ON CONFLICT(id) DO UPDATE SET
       sku = excluded.sku,
       name = excluded.name,
       description = excluded.description,
       details = excluded.details,
       price_paise = excluded.price_paise,
       image_url = excluded.image_url,
       active = 1,
       updated_at = excluded.updated_at`,
  );
  const run = db.transaction(() => {
    for (const entry of CATALOG) {
      upsert.run({ ...entry, now });
    }
  });
  run();
}

function insertUser(userId: string, email: string, password: string, fullName: string): void {
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    'INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(userId, email.toLowerCase(), hash, fullName, 'CUSTOMER', daysAgoIso(60));
  db.prepare(
    'INSERT OR IGNORE INTO customer_profiles (user_id, phone, comm_prefs, notif_prefs) VALUES (?, ?, ?, ?)',
  ).run(userId, '+919876543210', '{"email":true,"sms":false}', '{"returns":true,"offers":false}');
  db.prepare(
    `INSERT OR IGNORE INTO addresses (id, user_id, label, full_name, line1, line2, city, state, postal_code, country, phone, is_default, created_at, updated_at)
     VALUES (?, ?, 'HOME', ?, '221 MG Road', 'Apartment 4B', 'Bengaluru', 'Karnataka', '560001', 'IN', '+919876543210', 1, ?, ?)`,
  ).run(`addr-${userId}`, userId, fullName, daysAgoIso(60), daysAgoIso(60));
}

interface SeededOrder {
  id: string;
  orderNumber: string;
  placedDaysAgo: number;
  deliveredDaysAgo: number;
  note: string;
  lines: Array<{ itemId: string; productId: string; quantity: number }>;
}

const SEEDED_ORDERS: readonly SeededOrder[] = [
  {
    id: 'o-2026-1001',
    orderNumber: 'ORD-2026-1001',
    placedDaysAgo: 11,
    deliveredDaysAgo: 6,
    note: 'Inside the return window; nothing returned yet.',
    lines: [
      { itemId: 'oi-1001-a', productId: 'p-tee', quantity: 2 },
      { itemId: 'oi-1001-b', productId: 'p-denim', quantity: 1 },
    ],
  },
  {
    id: 'o-2026-1002',
    orderNumber: 'ORD-2026-1002',
    placedDaysAgo: 25,
    deliveredDaysAgo: 20,
    note: 'Inside the window; hosts the seeded return under inspection.',
    lines: [{ itemId: 'oi-1002-a', productId: 'p-trail', quantity: 1 }],
  },
  {
    id: 'o-2026-1003',
    orderNumber: 'ORD-2026-1003',
    placedDaysAgo: 50,
    deliveredDaysAgo: 45,
    note: 'Past the 30-day window, so it demonstrates an expired return.',
    lines: [{ itemId: 'oi-1003-a', productId: 'p-airmax', quantity: 1 }],
  },
];

/** The catalogue product priced at purchase time, shaped for createOrder. */
function orderLine(itemId: string, productId: string, quantity: number) {
  const entry = product(productId);
  return {
    id: itemId,
    productId: entry.id,
    sku: entry.sku,
    productName: entry.name,
    quantity,
    unitPrice: unitPrice(productId),
    imageUrl: entry.imageUrl,
  };
}

/**
 * Bring already-seeded demo rows in line with the catalogue above.
 *
 * createOrder is INSERT OR IGNORE, so a database seeded before a catalogue
 * change keeps the old product, price, and image. Only the fixed demo ids are
 * touched; real customer orders are never rewritten.
 */
function realignSeededOrders(): void {
  const updateItem = db.prepare(
    `UPDATE order_items
        SET product_id = @productId, sku = @sku, product_name = @productName,
            quantity = @quantity, unit_price = @unitPrice, line_total = @lineTotal,
            unit_price_paise = @unitPricePaise, line_total_paise = @lineTotalPaise,
            product_image_url = @imageUrl
      WHERE id = @itemId`,
  );
  const updateOrder = db.prepare(
    'UPDATE orders SET subtotal = @subtotal, subtotal_paise = @subtotalPaise WHERE id = @orderId',
  );
  const updateRefund = db.prepare(
    `UPDATE refunds SET amount = @amount, amount_paise = @amountPaise
      WHERE return_id = @returnId AND status NOT IN ('COMPLETED', 'CANCELLED')`,
  );

  const run = db.transaction(() => {
    for (const order of SEEDED_ORDERS) {
      let subtotalPaise = 0;
      for (const line of order.lines) {
        const entry = product(line.productId);
        const linePaise = entry.pricePaise * line.quantity;
        subtotalPaise += linePaise;
        updateItem.run({
          itemId: line.itemId,
          productId: entry.id,
          sku: entry.sku,
          productName: entry.name,
          quantity: line.quantity,
          unitPrice: entry.pricePaise / 100,
          lineTotal: linePaise / 100,
          unitPricePaise: entry.pricePaise,
          lineTotalPaise: linePaise,
          imageUrl: entry.imageUrl,
        });
      }
      updateOrder.run({ orderId: order.id, subtotal: subtotalPaise / 100, subtotalPaise });
    }

    // Orders placed before the catalogue moved to real photos still snapshot
    // the old local SVGs. Point every stale local snapshot at the current
    // catalogue image so order history shows the same real photo as the store.
    db.prepare(
      `UPDATE order_items
          SET product_image_url = (
            SELECT image_url FROM products WHERE products.id = order_items.product_id
          )
        WHERE product_image_url LIKE '/products/%'`,
    ).run();

    // The seeded return covers the whole of its order line, so its pending
    // refund is worth exactly that line's current price.
    const seededRefundPaise = product('p-trail').pricePaise;
    updateRefund.run({
      returnId: 'r-2026-0841',
      amount: seededRefundPaise / 100,
      amountPaise: seededRefundPaise,
    });
  });
  run();
}

/**
 * Seed the warehouse operator. Warehouse accounts are provisioned here rather
 * than through signup: the public signup route always creates a CUSTOMER, so
 * there is no way to self-assign an operational role.
 */
function insertWarehouseUser(): void {
  const hash = bcrypt.hashSync('Warehouse123', 10);
  db.prepare(
    `INSERT INTO users (id, email, password_hash, full_name, role, warehouse_id, created_at)
     VALUES (?, ?, ?, ?, 'WAREHOUSE', ?, ?)
     ON CONFLICT(id) DO UPDATE SET role = 'WAREHOUSE', warehouse_id = excluded.warehouse_id`,
  ).run(
    WAREHOUSE_USER_ID,
    'warehouse@returnos.test',
    hash,
    'Warehouse Operator',
    DEFAULT_WAREHOUSE_ID,
    daysAgoIso(60),
  );
}

/**
 * Seed the admin account. Same rule as warehouse operators: admin accounts
 * are provisioned here, never through signup, so there is no
 * privilege-escalation path from public registration.
 */
function insertAdminUser(): void {
  const hash = bcrypt.hashSync('Admin123', 10);
  db.prepare(
    `INSERT INTO users (id, email, password_hash, full_name, role, warehouse_id, created_at)
     VALUES (?, ?, ?, ?, 'ADMIN', NULL, ?)
     ON CONFLICT(id) DO UPDATE SET role = 'ADMIN', warehouse_id = NULL`,
  ).run(
    ADMIN_USER_ID,
    'admin@returnos.test',
    hash,
    'ReturnOS Admin',
    daysAgoIso(60),
  );
}

/**
 * Seed the demo category tree and attach catalogue products that have none.
 * Assignment is NULL-only: an admin re-categorising a product in a dev
 * database must never have it silently moved back by a reseed.
 */
function seedCategories(): void {
  const now = nowIsoSeed();
  const upsert = db.prepare(
    `INSERT INTO categories (id, name, description, sort_order, active, created_at, updated_at)
     VALUES (@id, @name, @description, @sortOrder, 1, @now, @now)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
       sort_order = excluded.sort_order, updated_at = excluded.updated_at`,
  );
  const attach = db.prepare('UPDATE products SET category_id = ?, updated_at = ? WHERE id = ? AND category_id IS NULL');
  const run = db.transaction(() => {
    const categories = [
      { id: 'c-footwear', name: 'Footwear', description: 'Shoes and boots for road and trail.', sortOrder: 1, products: ['p-airmax', 'p-trail'] },
      { id: 'c-apparel', name: 'Apparel', description: 'Denim, tees and everyday clothing.', sortOrder: 2, products: ['p-denim', 'p-tee'] },
      { id: 'c-accessories', name: 'Accessories', description: 'Scarves and finishing layers.', sortOrder: 3, products: ['p-aurora'] },
    ];
    for (const category of categories) {
      upsert.run({ id: category.id, name: category.name, description: category.description, sortOrder: category.sortOrder, now });
      for (const productId of category.products) {
        attach.run(category.id, now, productId);
      }
    }
  });
  run();
}

/** Seed demo data. Safe to run repeatedly. */
export function seedDatabase(): void {
  initSchema();

  seedCatalog();
  seedCategories();

  insertWarehouseUser();
  insertAdminUser();
  // Notification templates seed here (demo content); operational settings
  // seed inside initSchema so every boot backfills missing keys.
  seedTemplates();
  // Establish the AVAILABLE buckets from catalogue stock so the warehouse and
  // the storefront start from the same numbers.
  syncAvailableBuckets(DEFAULT_WAREHOUSE_ID);

  insertUser(DEMO_USER_ID, 'rudrachokshi441@gmail.com', '123456', 'Rudra Chokshi');
  insertUser(MAYA_USER_ID, 'maya@example.com', 'Password123', 'Maya Sharma');

  // Every seeded order buys real catalogue products at catalogue prices, so the
  // store, order history, and returns all describe the same goods.
  for (const order of SEEDED_ORDERS) {
    createOrder({
      id: order.id,
      orderNumber: order.orderNumber,
      customerId: DEMO_USER_ID,
      status: 'DELIVERED',
      createdAt: daysAgoIso(order.placedDaysAgo),
      deliveredAt: daysAgoIso(order.deliveredDaysAgo),
      items: order.lines.map((line) => orderLine(line.itemId, line.productId, line.quantity)),
    });
  }
  realignSeededOrders();

  // The demo return starts life as REQUESTED with no warehouse rows behind
  // it, so the E2E demo can walk the whole floor flow naturally: approve →
  // receive → inspect → dispose → resolve. (It previously claimed INSPECTION
  // with APPROVED/INSPECTION events but no receiving or inspection rows —
  // status without substance that confused the queue.)
  const seedReturn = db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO returns (id, return_number, order_id, customer_id, status, resolution_type, description, created_at, updated_at, cancelled_at, cancel_reason)
       VALUES ('r-2026-0841', 'RET-2026-0841', 'o-2026-1002', ?, 'REQUESTED', 'REFUND', 'Sole stitching came apart after first use.', ?, ?, NULL, NULL)`,
    ).run(DEMO_USER_ID, daysAgoIso(2), daysAgoIso(2));

    db.prepare(
      'INSERT OR IGNORE INTO return_items (id, return_id, order_item_id, quantity, reason_code, description) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('ri-2026-0841-a', 'r-2026-0841', 'oi-1002-a', 1, 'DEFECTIVE', 'Stitching defect on the left shoe.');

    db.prepare(
      'INSERT OR IGNORE INTO return_events (id, return_id, status, description, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('re-0841-1', 'r-2026-0841', 'REQUESTED', 'Return request created by the customer.', daysAgoIso(2));

    db.prepare(
      `INSERT OR IGNORE INTO pickups (id, return_id, kind, address, date, time_window, carrier, tracking_number, status, created_at, updated_at)
       VALUES ('pk-0841', 'r-2026-0841', 'PICKUP', '221 MG Road, Apartment 4B, Bengaluru 560001', ?, '10:00-14:00', 'Delhivery', 'DLV88410231', 'SCHEDULED', ?, ?)`,
    ).run(daysAgoIso(1), daysAgoIso(2), daysAgoIso(2));

    db.prepare(
      'INSERT OR IGNORE INTO refunds (id, return_id, kind, amount, method, status, initiated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
    ).run('rf-0841', 'r-2026-0841', 'REFUND', unitPrice('p-trail'), 'ORIGINAL_METHOD', 'PENDING', daysAgoIso(1));

    db.prepare('INSERT OR IGNORE INTO return_counter (year, last_seq) VALUES (?, ?)').run('2026', 841);
    db.prepare('UPDATE return_counter SET last_seq = MAX(last_seq, 841) WHERE year = ?').run('2026');
  });
  seedReturn();

  const existingNotice = db
    .prepare('SELECT id FROM notifications WHERE user_id = ? AND return_id = ? AND type = ? LIMIT 1')
    .get(DEMO_USER_ID, 'r-2026-0841', 'RETURN_STATUS') as { id: string } | undefined;
  if (existingNotice === undefined) {
    createNotification(DEMO_USER_ID, {
      returnId: 'r-2026-0841',
      type: 'RETURN_STATUS',
      title: 'Return request received',
      body: 'Return RET-2026-0841 was created and is awaiting review.',
    });
  }
}

const invokedAsMain =
  process.argv[1] !== undefined && process.argv[1].replace(/\\/g, '/').endsWith('/seed.ts');

if (invokedAsMain) {
  seedDatabase();
}
