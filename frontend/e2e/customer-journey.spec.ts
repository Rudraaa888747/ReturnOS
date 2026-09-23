import { test, expect, type Page, type Browser } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'path';

// ---------------------------------------------------------------------------
// End-to-end lifecycle, warehouse-driven:
//   signup -> store -> cart -> checkout -> order -> delivery (scheduler still
//   owns the carrier legs) -> return (UI wizard) -> warehouse floor UI
//   (approve -> receive -> inspect -> dispose) -> customer sees the payout.
//
// The scheduler NO LONGER resolves returns (it stops at IN_TRANSIT), so the
// resolution leg goes through the real floor UI in a second browser context
// acting as the operator — two actors, one lifecycle, no shortcuts.
//
// The only thing this spec touches in the database is the *clock* (backdate a
// stage timestamp so the scheduler considers the next carrier stage due) and
// id lookups by number. Every status change, refund row, ledger entry, and
// replacement order is written by real backend code, so the test cannot pass
// on state it invented.
//
// Chromium-only: four full lifecycles are too heavy to repeat per browser.
// ---------------------------------------------------------------------------

const dbPath = path.resolve(import.meta.dirname, '../../backend/data/returnos.db');
const db = new Database(dbPath);

const LONG_AGO = new Date(Date.now() - 86_400_000).toISOString();
const SHOTS = 'e2e/screenshots';

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Backdate an order's stage clock so the scheduler treats its next stage as due. */
function nudgeOrderClock(orderNumber: string): void {
  const row = db.prepare('SELECT id FROM orders WHERE order_number = ?').get(orderNumber) as { id: string } | undefined;
  if (!row) throw new Error(`Order ${orderNumber} not found`);
  db.prepare('UPDATE orders SET created_at = ? WHERE id = ?').run(LONG_AGO, row.id);
  db.prepare('UPDATE order_events SET created_at = ? WHERE order_id = ?').run(LONG_AGO, row.id);
}

/** Poll the database until the backend has advanced the order to `status`. */
async function waitForOrderStatus(orderNumber: string, status: string): Promise<void> {
  await expect
    .poll(
      () => {
        nudgeOrderClock(orderNumber);
        const row = db.prepare('SELECT status FROM orders WHERE order_number = ?').get(orderNumber) as
          | { status: string }
          | undefined;
        return row?.status;
      },
      { timeout: 120_000, intervals: [500] },
    )
    .toBe(status);
}

function orderIdOf(orderNumber: string): string {
  const row = db.prepare('SELECT id FROM orders WHERE order_number = ?').get(orderNumber) as { id: string };
  return row.id;
}

function orderItemIdOf(orderId: string): string {
  const row = db.prepare('SELECT id FROM order_items WHERE order_id = ?').get(orderId) as { id: string };
  return row.id;
}

function returnIdOf(returnNumber: string): string {
  const row = db.prepare('SELECT id FROM returns WHERE return_number = ?').get(returnNumber) as { id: string };
  return row.id;
}

/** Fresh account per run: shares no cart with any other spec. */
async function signup(page: Page): Promise<void> {
  const email = `journey-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
  await page.goto('/signup');
  await page.fill('#signup-name', 'Journey Customer');
  await page.fill('#signup-email', email);
  await page.fill('#signup-password', 'Password123');
  await page.fill('#signup-confirm', 'Password123');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/customer(\/.*)?$/);
}

/** Add the first catalogue product to the cart in one visit and return its name. */
async function addFirstProductToCart(page: Page, quantity = 1): Promise<string> {
  await page.goto('/customer/store');
  await expect(page.locator('h1')).toContainText('Shop products');
  const cards = page.locator('li').filter({ hasText: 'Add to Cart' });
  await expect(cards.first()).toBeVisible();

  // Pick a card that can actually satisfy the quantity asked for. Taking the
  // first card blindly made this depend on whatever stock the previous run
  // left: a product down to two units cannot be stepped up to four.
  const count = await cards.count();
  let chosen = cards.first();
  for (let index = 0; index < count; index += 1) {
    const card = cards.nth(index);
    const text = (await card.textContent()) ?? '';
    const low = text.match(/Only (\d+) left/);
    if (low === null || Number(low[1]) >= quantity) {
      chosen = card;
      break;
    }
  }

  const name = (await chosen.locator('h2').first().textContent())?.trim() ?? '';
  await chosen.locator('a').first().click();
  await expect(page.locator('h1')).toContainText(name);
  for (let i = 1; i < quantity; i += 1) {
    await page.getByRole('button', { name: `Increase quantity for ${name}` }).click();
  }
  await page.click('button:has-text("Add to Cart")');
  await expect(page.locator('text=added to your cart')).toBeVisible();
  return name;
}

/** Check out the current cart and return the created order number. */
async function checkout(page: Page, options: { useCredit: boolean }): Promise<string> {
  await page.goto('/customer/cart');
  await expect(page.locator('h1')).toContainText('Your cart');
  await page.click('a:has-text("Proceed to checkout")');
  await expect(page.locator('h1')).toContainText('Checkout');

  // Fresh accounts have no delivery address: add one through the real form.
  // (The address picker only renders once at least one address exists.
  // Explicit short timeouts: the repo default actionTimeout is unbounded,
  // so a missed selector must fail fast here instead of eating the budget.)
  if ((await page.locator('[role="radiogroup"]').count()) === 0) {
    if ((await page.locator('#co-name').count()) === 0) {
      await page.getByRole('button', { name: 'Add a new address' }).click({ timeout: 15000 });
    }
    await expect(page.locator('#co-name')).toBeVisible({ timeout: 15000 });
    await page.fill('#co-name', 'Journey Customer');
    await page.fill('#co-line1', '221 MG Road');
    await page.fill('#co-city', 'Bengaluru');
    await page.fill('#co-state', 'Karnataka');
    await page.fill('#co-postal', '560001');
    await page.click('button:has-text("Save and use this address")');
  }
  await expect(page.getByRole('button', { name: 'Place Order' })).toBeEnabled({ timeout: 30000 });

  if (options.useCredit) {
    const toggle = page.locator('input#use-credit');
    await expect(toggle).toBeEnabled();
    await toggle.check();
    // The payable figure is recalculated server-side; the used-credit row
    // must move off zero before placing the order.
    const usedRow = page.locator('div', { has: page.locator('span:text-is("Store credit used")') }).last();
    await expect(usedRow.locator('span').nth(1)).not.toHaveText('−₹0', { timeout: 15000 });
  }

  await page.click('button:has-text("Place Order")');
  await expect(page.locator('h1')).toContainText('Order ORD-');
  const heading = (await page.locator('h1').first().textContent()) ?? '';
  const match = heading.match(/(ORD-\d{4}-\d{4})/);
  expect(match, `expected an order number in "${heading}"`).toBeTruthy();
  return (match as RegExpMatchArray)[1];
}

/** Run the New-Return wizard in the browser; returns the created return number. */
async function createReturn(
  page: Page,
  orderId: string,
  itemId: string,
  reasonLabel: string,
  resolutionLabel: string,
): Promise<string> {
  await page.goto(`/customer/returns/new?orderId=${orderId}&itemId=${itemId}`);
  await expect(page.locator('h1')).toContainText('Start a return');

  await page.click('button:has-text("Next")'); // order (preselected)
  await page.click('button:has-text("Next")'); // items (qty 1 preselected)
  await page.locator('label', { hasText: reasonLabel }).click();
  await page.click('button:has-text("Next")'); // reason
  await page.fill('textarea#overall-note', 'E2E warehouse-driven lifecycle check.');
  await page.click('button:has-text("Next")'); // description
  await page.click('button:has-text("Next")'); // evidence (optional)

  await page.locator('label', { hasText: resolutionLabel }).first().click();
  await page.locator('label', { hasText: 'DROP OFF' }).click();
  await page.click('button:has-text("Next")'); // resolution + pickup
  await page.click('button:has-text("Next")'); // review
  await page.click('button:has-text("Submit return request")');

  await expect(page.locator('text=Your return request was created successfully')).toBeVisible();
  const body = (await page.locator('body').textContent()) ?? '';
  const returnMatch = body.match(/(RET-\d{4}-\d{4})/);
  expect(returnMatch, 'expected a return number on the confirmation').toBeTruthy();
  return (returnMatch as RegExpMatchArray)[1];
}

/** Log the operator in on a second context and open the return file. */
async function openFloorFile(browser: Browser, returnNumber: string) {
  const context = await browser.newContext();
  const op = await context.newPage();
  await op.goto('/login');
  await op.getByLabel('Email').fill('warehouse@returnos.test');
  await op.getByLabel('Password').fill('Warehouse123');
  await op.getByRole('button', { name: 'Sign in' }).click();
  await expect(op).toHaveURL(/\/warehouse(\/.*)?$/);
  await op.goto('/warehouse/returns');
  await op.getByPlaceholder(/Return, order, tracking/).fill(returnNumber);
  // Wait for the server-side filter to narrow to exactly this return:
  // clicking the first row before the debounce lands resolves someone else.
  const row = op.locator('tbody tr', { hasText: returnNumber });
  await expect(row).toHaveCount(1);
  await row.locator('td a').first().click();
  await expect(op.getByLabel('Workflow progress')).toBeVisible();
  return { context, op };
}

/** Walk approve → receive → inspect → dispose in the floor UI. */
async function driveFloorResolution(op: Page, returnNumber: string): Promise<void> {
  const approve = op.getByRole('button', { name: 'Approve return' });
  await expect(op.getByRole('button', { name: /Approve return|Record receipt/ }).first()).toBeVisible();
  if ((await approve.count()) > 0) {
    await approve.click();
  }
  await op.getByRole('button', { name: 'Record receipt' }).click();
  await op.getByRole('button', { name: 'Start inspection' }).click();
  await op.getByRole('button', { name: 'Complete inspection' }).click();
  await op.getByRole('button', { name: /Record (RESTOCK|RESELL)/ }).first().click();
  await expect(op.getByText('has been applied')).toBeVisible();
  await op.screenshot({ path: `${SHOTS}/floor-resolved-${returnNumber}.png` });
}

async function loginDemo(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'rudrachokshi441@gmail.com');
  await page.fill('input[type="password"]', '123456');
  await page.click('button:has-text("Sign in")');
  await expect(page).toHaveURL(/\/customer(\/.*)?$/);
}

test('warehouse-driven lifecycle: credit, refund, replacement, exchange', async ({ page, browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'four full lifecycles run on chromium only');
  test.setTimeout(900_000);

  await signup(page);

  // ---- One order with four units feeds all four resolution paths --------
  const productName = await addFirstProductToCart(page, 4);
  const orderNumber = await checkout(page, { useCredit: false });
  const orderId = orderIdOf(orderNumber);
  const itemId = orderItemIdOf(orderId);
  await shot(page, 'journey-order-placed');

  await page.goto('/customer/orders');
  await expect(page.locator(`text=${orderNumber}`).first()).toBeVisible();

  // ---- The carrier legs still belong to the scheduler --------------------
  await waitForOrderStatus(orderNumber, 'DELIVERED');
  await page.goto(`/customer/orders/${orderId}`);
  await expect(page.locator('text=Eligible until').first()).toBeVisible();
  await shot(page, 'journey-order-delivered');

  const legs: Array<{ reason: string; resolution: string; tag: string }> = [
    { reason: 'Changed mind', resolution: 'STORE CREDIT', tag: 'credit' },
    { reason: 'Changed mind', resolution: 'REFUND', tag: 'refund' },
    { reason: 'Defective product', resolution: 'REPLACEMENT', tag: 'replacement' },
    { reason: 'Defective product', resolution: 'EXCHANGE', tag: 'exchange' },
  ];

  for (const leg of legs) {
    const returnNumber = await createReturn(page, orderId, itemId, leg.reason, leg.resolution);
    await shot(page, `journey-return-created-${leg.tag}`);

    const { context, op } = await openFloorFile(browser, returnNumber);
    await driveFloorResolution(op, returnNumber);
    await context.close();

    // The customer sees the outcome with no manual refresh assumptions:
    // every check below navigates fresh.
    await page.goto(`/customer/returns/${returnIdOf(returnNumber)}`);
    await expect(page.locator('body')).toContainText('RESOLVED');
    await shot(page, `journey-customer-sees-${leg.tag}`);
  }

  // ---- Store credit landed exactly once and is spendable ------------------
  const creditRow = db
    .prepare(
      `SELECT amount_paise FROM store_credit_ledger WHERE reference_type = 'RETURN'
        AND reference_id IN (SELECT id FROM returns WHERE order_id = ?)`,
    )
    .all(orderIdOf(orderNumber)) as Array<{ amount_paise: number }>;
  expect(creditRow).toHaveLength(1);
  expect(creditRow[0].amount_paise).toBeGreaterThan(0);

  await page.goto('/customer/profile');
  await expect(page.locator('h2:has-text("Store Credit")')).toBeVisible();
  // CSS-module hashes defeat plain class selectors; read the value
  // structurally: the balance is the second div inside its card.
  const balanceCard = page.locator('div:has(> div:text-is("Available balance"))').first();
  const balanceText = (await balanceCard.locator('div').nth(1).textContent()) ?? '';
  expect(balanceText).not.toBe('₹0');

  // ---- Refund completed on the return file --------------------------------
  const refundNumber = (
    db.prepare(`SELECT return_number FROM returns WHERE order_id = ? AND resolution_type = 'REFUND'`).get(orderIdOf(orderNumber)) as {
      return_number: string;
    }
  ).return_number;
  await page.goto(`/customer/returns/${returnIdOf(refundNumber)}`);
  const resolution = page.locator('section', { has: page.locator('h2', { hasText: 'Resolution' }) });
  await expect(resolution.getByText('Refund kind')).toBeVisible();
  // The Status dd sits right after its dt; the section also has a
  // "Completed" *label*, so the value cell is targeted precisely.
  await expect(resolution.locator('dt:text-is("Status") + dd')).toContainText('Completed');

  // ---- Replacement and exchange ship as linked zero-value orders ----------
  for (const kind of ['REPLACEMENT', 'EXCHANGE'] as const) {
    const linked = db
      .prepare('SELECT order_number FROM orders WHERE kind = ? AND customer_id = (SELECT customer_id FROM orders WHERE order_number = ?)')
      .get(kind, orderNumber) as { order_number: string };
    await page.goto('/customer/orders');
    await expect(page.locator(`text=${linked.order_number}`).first()).toBeVisible();
    const linkedId = orderIdOf(linked.order_number);
    await page.goto(`/customer/orders/${linkedId}`);
    await expect(page.locator('body')).toContainText(productName);
    await expect(page.locator('body')).toContainText('₹0');
    await waitForOrderStatus(linked.order_number, 'DELIVERED');
    await page.goto(`/customer/orders/${linkedId}`);
    await expect(page.locator('h2', { hasText: 'Tracking' })).toBeVisible();
    await expect(page.locator('body')).toContainText('DELIVERED');
    await shot(page, `journey-${kind.toLowerCase()}-delivered`);
  }

  // ---- Spend the credit on a new order ------------------------------------
  await addFirstProductToCart(page);
  const creditOrderNumber = await checkout(page, { useCredit: true });
  const creditOrder = db.prepare('SELECT credit_used_paise FROM orders WHERE order_number = ?').get(creditOrderNumber) as {
    credit_used_paise: number;
  };
  expect(creditOrder.credit_used_paise).toBeGreaterThan(0);
  await shot(page, 'journey-credit-spent');
});

test('My Returns leads with the product, not the return ID', async ({ page }) => {
  await loginDemo(page);
  await page.goto('/customer/returns');
  await expect(page.locator('h1')).toContainText('returns', { ignoreCase: true });

  const firstCard = page.locator('li').filter({ has: page.locator('a:has-text("View details")') }).first();
  await expect(firstCard).toBeVisible();

  // The product name is the card's heading; the return number is present but
  // demoted to metadata under a "Return ID" label.
  await expect(firstCard.locator('h2')).toBeVisible();
  const heading = (await firstCard.locator('h2').textContent()) ?? '';
  expect(heading).not.toMatch(/^RET-/);
  await expect(firstCard.locator('text=Return ID')).toBeVisible();
});
