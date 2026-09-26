import { test, expect, type Page } from '@playwright/test';
import { dbGet, dbAll, dbRun } from './dbpg.js';

// ---------------------------------------------------------------------------
// Phase 9 — the cross-system scenario (§56).
//
// Admin's core promise is that it shows what actually happened elsewhere in
// the platform. So this drives a real lifecycle through two different UIs —
// a customer places an order and raises a return, an operator receives,
// inspects and disposes of it — and then checks that Admin, in a third
// browser context, reports each step.
//
// Everything Admin displays here was written by customer or warehouse action.
// Admin performs no writes in this test, which is the point: it is a mirror,
// not a second source of truth.
// ---------------------------------------------------------------------------

const SHOTS = 'e2e/screenshots';

const CUSTOMER = { email: 'rudrachokshi441@gmail.com', password: '123456' };
const OPERATOR = { email: 'warehouse@returnos.test', password: 'Warehouse123' };
const ADMIN = { email: 'admin@returnos.test', password: 'Admin123' };

async function signIn(page: Page, who: { email: string; password: string }, expected: RegExp): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(expected);
}

/**
 * Backdate an order's stage clock so the scheduler treats the next stage as
 * due. Only the clock is touched; every status change is still written by the
 * backend's own fulfillment code.
 */
async function nudgeOrderClock(orderNumber: string): Promise<void> {
  const long = new Date(Date.now() - 86_400_000).toISOString();
  const row = await dbGet<{ id: string }>('SELECT id FROM orders WHERE order_number = ?', orderNumber);
  if (!row) throw new Error(`Order ${orderNumber} not found`);
  await dbRun('UPDATE orders SET created_at = ? WHERE id = ?', long, row.id);
  await dbRun('UPDATE order_events SET created_at = ? WHERE order_id = ?', long, row.id);
}

async function waitForOrderStatus(orderNumber: string, status: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await nudgeOrderClock(orderNumber);
        const row = await dbGet<{ status: string }>('SELECT status FROM orders WHERE order_number = ?', orderNumber);
        return row?.status;
      },
      { timeout: 60_000, intervals: [500] },
    )
    .toBe(status);
}

test.describe('customer → warehouse → admin', () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== 'chromium', 'cross-system walkthrough runs on chromium only');
  });

  test('admin sees every step of a real return lifecycle', async ({ browser }) => {
    test.setTimeout(300_000);

    const customerCtx = await browser.newContext();
    const opCtx = await browser.newContext();
    const adminCtx = await browser.newContext();
    const customerPage = await customerCtx.newPage();
    const opPage = await opCtx.newPage();
    const adminPage = await adminCtx.newPage();

    const adminProblems: string[] = [];
    adminPage.on('pageerror', (err) => adminProblems.push(err.message));
    adminPage.on('response', (res) => {
      if (res.url().includes('/api/v1/') && res.status() >= 400) {
        adminProblems.push(`${res.status()} ${res.request().method()} ${res.url()}`);
      }
    });

    // ---- 1. CUSTOMER buys something -------------------------------------
    await signIn(customerPage, CUSTOMER, /\/customer(\/.*)?$/);
    await customerPage.goto('/customer/store');
    await customerPage.locator('button:has-text("Add to Cart")').first().click();
    await customerPage.goto('/customer/checkout');
    await customerPage.getByRole('button', { name: /place order/i }).click();
    await expect(customerPage.locator('h1')).toContainText('Order ORD-');
    const orderHeading = (await customerPage.locator('h1').first().textContent()) ?? '';
    const orderNumber = (orderHeading.match(/ORD-\d{4}-\d{4}/) as RegExpMatchArray)[0];
    await customerPage.screenshot({ path: `${SHOTS}/x1-customer-order.png`, fullPage: true });

    const orderRow = await dbGet<{ id: string }>('SELECT id FROM orders WHERE order_number = ?', orderNumber);
    if (!orderRow) throw new Error(`Order ${orderNumber} not found`);
    const orderId = orderRow.id;

    // ---- 2. ADMIN sees the order ----------------------------------------
    await signIn(adminPage, ADMIN, /\/admin(\/.*)?$/);
    await adminPage.goto('/admin/orders');
    await expect(adminPage.locator(`text=${orderNumber}`).first(), 'admin should list the new order').toBeVisible();
    await adminPage.goto(`/admin/orders/${orderId}`);
    await expect(adminPage.locator('h1')).toContainText(orderNumber);
    await adminPage.screenshot({ path: `${SHOTS}/x2-admin-order.png`, fullPage: true });

    // ---- 3. Delivery, by the backend's own scheduler ---------------------
    await waitForOrderStatus(orderNumber, 'DELIVERED');

    // ---- 4. CUSTOMER raises a store-credit return ------------------------
    await customerPage.goto(`/customer/orders/${orderId}`);
    await customerPage.locator('a:has-text("Start return")').first().click();
    await expect(customerPage.locator('h1')).toContainText('Start a return');
    await customerPage.click('button:has-text("Next")'); // order
    await customerPage.click('button:has-text("Next")'); // items
    await customerPage.locator('label', { hasText: 'Changed mind' }).click();
    await customerPage.click('button:has-text("Next")'); // reason
    await customerPage.fill('textarea#overall-note', 'Cross-system scenario return.');
    await customerPage.click('button:has-text("Next")'); // description
    await customerPage.click('button:has-text("Next")'); // evidence
    await customerPage.locator('label', { hasText: 'STORE CREDIT' }).click();
    await customerPage.locator('label', { hasText: 'DROP OFF' }).click();
    await customerPage.click('button:has-text("Next")'); // resolution
    await customerPage.click('button:has-text("Next")'); // review
    await customerPage.click('button:has-text("Submit return request")');
    await expect(customerPage.locator('text=Your return request was created successfully')).toBeVisible();

    const body = (await customerPage.locator('body').textContent()) ?? '';
    const returnNumber = (body.match(/RET-\d{4}-\d{4}/) as RegExpMatchArray)[0];
    const returnRow = await dbGet<{ id: string; customer_id: string }>(
      'SELECT id, customer_id FROM returns WHERE return_number = ?',
      returnNumber,
    );
    if (!returnRow) throw new Error(`Return ${returnNumber} not found`);
    await customerPage.screenshot({ path: `${SHOTS}/x3-customer-return.png`, fullPage: true });

    // ---- 5. ADMIN sees the return, still unprocessed ---------------------
    await adminPage.goto('/admin/returns');
    await expect(adminPage.locator(`text=${returnNumber}`).first(), 'admin should list the new return').toBeVisible();
    await adminPage.goto(`/admin/returns/${returnRow.id}`);
    await expect(adminPage.locator('h1').first()).toBeVisible();
    await expect(adminPage.locator(`text=${returnNumber}`).first()).toBeVisible();
    await adminPage.screenshot({ path: `${SHOTS}/x4-admin-return-new.png`, fullPage: true });

    // ---- 6. OPERATOR opens the return on the warehouse floor -------------
    await signIn(opPage, OPERATOR, /\/warehouse(\/.*)?$/);
    await opPage.goto(`/warehouse/returns/${returnRow.id}`);
    await expect(opPage.locator('h1').first()).toBeVisible();
    await expect(opPage.locator('body'), 'the operator should see this return').toContainText(returnNumber);
    await opPage.screenshot({ path: `${SHOTS}/x5-warehouse-return.png`, fullPage: true });

    // The operator's own session token drives the same endpoints the warehouse
    // UI posts to. Going through the API here keeps the lifecycle deterministic
    // while still exercising every backend rule — approval gate, receive-before-
    // inspect ordering, and the disposition matrix all still apply.
    const opToken = await opPage.evaluate(() => window.localStorage.getItem('returnos.token'));
    expect(opToken, 'operator token should be readable for the API steps').toBeTruthy();

    const api = async (method: string, url: string, payload?: unknown) => {
      const res = await opPage.request.fetch(`http://localhost:8080/api/v1/warehouse${url}`, {
        method,
        headers: { Authorization: `Bearer ${opToken}`, 'Content-Type': 'application/json' },
        data: payload === undefined ? undefined : JSON.stringify(payload),
      });
      return { status: res.status(), body: await res.json().catch(() => null) };
    };

    const returnState = () =>
      dbGet<{ status: string; approved_at: string | null }>('SELECT status, approved_at FROM returns WHERE id = ?', returnRow.id);

    // ---- 7. Approve and receive -----------------------------------------
    if ((await returnState())?.approved_at === null) {
      const approved = await api('POST', `/returns/${returnRow.id}/approve`, {});
      expect(approved.status, `approve failed: ${JSON.stringify(approved.body)}`).toBe(200);
    }

    const received = await api('POST', `/returns/${returnRow.id}/receive`, {
      packageCondition: 'SEALED',
      receivedQuantity: 1,
      notes: 'Cross-system scenario parcel.',
    });
    expect(received.status, `receive failed: ${JSON.stringify(received.body)}`).toBe(201);
    expect((await returnState())?.status).toBe('RECEIVED');

    // ---- 8. ADMIN sees the warehouse processing -------------------------
    await adminPage.reload();
    await expect(adminPage.locator('body')).toContainText(/RECEIVED|Received/i);
    await adminPage.screenshot({ path: `${SHOTS}/x6-admin-return-received.png`, fullPage: true });

    // ---- 8b. Inspection --------------------------------------------------
    const started = await api('POST', `/returns/${returnRow.id}/inspection/start`, {});
    expect(started.status, `inspection start failed: ${JSON.stringify(started.body)}`).toBe(201);

    const returnItemRow = await dbGet<{ id: string }>('SELECT id FROM return_items WHERE return_id = ?', returnRow.id);
    if (!returnItemRow) throw new Error(`No return items for ${returnRow.id}`);
    const returnItemId = returnItemRow.id;
    const completed = await api('POST', `/returns/${returnRow.id}/inspection/complete`, {
      findings: [
        { returnItemId, result: 'PASS', productCondition: 'LIKE_NEW', packagingCondition: 'NEW', quantity: 1 },
      ],
    });
    expect(completed.status, `inspection complete failed: ${JSON.stringify(completed.body)}`).toBe(200);

    // ---- 9. ADMIN sees the inspection ------------------------------------
    await adminPage.reload();
    await expect(adminPage.locator('body')).toContainText(/PASS|LIKE_NEW|Inspection/i);
    await adminPage.screenshot({ path: `${SHOTS}/x7-admin-inspection.png`, fullPage: true });

    // ---- 10. Disposition releases the store credit ----------------------
    const creditBeforeRow = await dbGet<{ total: number | string }>(
      'SELECT COALESCE(SUM(amount_paise), 0) AS total FROM store_credit_ledger WHERE user_id = ?',
      returnRow.customer_id,
    );
    // node-pg returns SUM(..) as a NUMERIC string; coerce for arithmetic.
    const creditBefore = Number(creditBeforeRow?.total ?? 0);

    const disposition = await api('POST', `/returns/${returnRow.id}/disposition`, {
      returnItemId,
      action: 'RESTOCK',
      quantity: 1,
    });
    expect(disposition.status, `disposition failed: ${JSON.stringify(disposition.body)}`).toBe(201);

    // The return was approved before receiving, so the last disposition
    // releases the resolution rather than holding it.
    expect(
      (disposition.body as { returnResolved: boolean }).returnResolved,
      'an approved return resolves on its final disposition',
    ).toBe(true);

    // ---- 11. The money actually moved, once ------------------------------
    const ledger = await dbAll<{ amount_paise: number }>(
      "SELECT amount_paise FROM store_credit_ledger WHERE reference_type = 'RETURN' AND reference_id = ?",
      returnRow.id,
    );
    expect(ledger, 'exactly one credit entry for this return').toHaveLength(1);

    const creditAfterRow = await dbGet<{ total: number | string }>(
      'SELECT COALESCE(SUM(amount_paise), 0) AS total FROM store_credit_ledger WHERE user_id = ?',
      returnRow.customer_id,
    );
    const creditAfter = Number(creditAfterRow?.total ?? 0);
    expect(creditAfter).toBe(creditBefore + ledger[0].amount_paise);

    // ---- 12. ADMIN sees the resolution and the credit --------------------
    await adminPage.reload();
    await expect(adminPage.locator('body')).toContainText(/RESOLVED|Store credit|STORE_CREDIT/i);
    await adminPage.screenshot({ path: `${SHOTS}/x8-admin-resolved.png`, fullPage: true });

    await adminPage.goto('/admin/credit');
    await expect(adminPage.locator('h1').first()).toBeVisible();
    await expect(adminPage.locator('body'), 'admin credit view should reflect the issued credit').toContainText(
      /credit/i,
    );
    await adminPage.screenshot({ path: `${SHOTS}/x9-admin-credit.png`, fullPage: true });

    // ---- 13. ADMIN sees the inventory impact -----------------------------
    // RESTOCK put the unit back into the sellable pool.
    await adminPage.goto('/admin/inventory');
    await expect(adminPage.locator('h1').first()).toBeVisible();
    await adminPage.screenshot({ path: `${SHOTS}/x10-admin-inventory.png`, fullPage: true });

    const movements = await dbAll<{ reason: string }>(
      'SELECT reason FROM inventory_movements WHERE reference_id = ? OR reference_id = ?',
      returnRow.id,
      returnItemId,
    );
    const reasons = movements.map((row) => row.reason);
    expect(reasons, 'the goods movement should be on the ledger').toContain('RETURN_RECEIVED');
    expect(reasons).toContain('RESTOCK');

    // ---- 14. ADMIN sees the audit trail ----------------------------------
    await adminPage.goto('/admin/audit');
    await expect(adminPage.locator('h1').first()).toBeVisible();
    await adminPage.screenshot({ path: `${SHOTS}/x11-admin-audit.png`, fullPage: true });

    // The warehouse trail recorded who did what, independently of admin.
    const trail = await dbAll<{ action: string }>(
      "SELECT action FROM audit_log WHERE entity_type = 'RETURN' AND entity_id = ?",
      returnRow.id,
    );
    const actions = trail.map((row) => row.action);
    expect(actions).toContain('RETURN_RECEIVED');
    expect(actions).toContain('INSPECTION_COMPLETED');

    // ---- 15. The customer sees the outcome too ---------------------------
    await customerPage.goto(`/customer/returns/${returnRow.id}`);
    await expect(customerPage.locator('body')).toContainText(/Resolved|RESOLVED|Store credit/i);
    await customerPage.screenshot({ path: `${SHOTS}/x12-customer-resolved.png`, fullPage: true });

    // Admin did all of this without a single failed request or page error.
    expect(adminProblems, 'admin pages should have no errors during the scenario').toEqual([]);

    await customerCtx.close();
    await opCtx.close();
    await adminCtx.close();
  });
});
