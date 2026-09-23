import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'path';

// ---------------------------------------------------------------------------
// Floor task actions, clicked for real: claim -> complete, block with and
// without a reason. Setup (account, order, return) goes through the public
// API; the carrier legs advance on the scheduler. Task state changes only
// ever happen through the buttons below. Chromium-only like the other
// floor specs.
// ---------------------------------------------------------------------------

const dbPath = path.resolve(import.meta.dirname, '../../backend/data/returnos.db');
const db = new Database(dbPath);

const LONG_AGO = new Date(Date.now() - 86_400_000).toISOString();
const SHOTS = 'e2e/screenshots';

function nudgeOrderClock(orderNumber: string): void {
  const row = db.prepare('SELECT id FROM orders WHERE order_number = ?').get(orderNumber) as { id: string } | undefined;
  if (!row) throw new Error(`Order ${orderNumber} not found`);
  db.prepare('UPDATE orders SET created_at = ? WHERE id = ?').run(LONG_AGO, row.id);
  db.prepare('UPDATE order_events SET created_at = ? WHERE order_id = ?').run(LONG_AGO, row.id);
}

function nudgeReturnClock(returnId: string): void {
  db.prepare('UPDATE returns SET updated_at = ? WHERE id = ?').run(LONG_AGO, returnId);
}

async function waitForReturnStatus(returnId: string, status: string): Promise<void> {
  await expect
    .poll(
      () => {
        nudgeReturnClock(returnId);
        const row = db.prepare('SELECT status FROM returns WHERE id = ?').get(returnId) as
          | { status: string }
          | undefined;
        return row?.status;
      },
      { timeout: 120_000, intervals: [500] },
    )
    .toBe(status);
}

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

interface ApiSession {
  token: string;
  userId: string;
}

async function apiSignup(page, prefix: string): Promise<ApiSession> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
  const res = await page.request.post('/api/v1/auth/signup', {
    data: { email, password: 'Password123', fullName: 'Task Flow Customer' },
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

async function apiAddress(page, token: string): Promise<string> {
  const res = await page.request.post('/api/v1/addresses', {
    headers: { Authorization: `Bearer ${token}` },
    data: { fullName: 'Task Flow', line1: '221 MG Road', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { address: { id: string } }).address.id;
}

async function apiCheckout(page, token: string, addressId: string): Promise<{ orderId: string; orderNumber: string }> {
  const added = await page.request.post('/api/v1/cart', {
    headers: { Authorization: `Bearer ${token}` },
    data: { productId: 'p-tee', quantity: 1 },
  });
  expect(added.ok()).toBe(true);
  const placed = await page.request.post('/api/v1/checkout', {
    headers: { Authorization: `Bearer ${token}` },
    data: { addressId, useStoreCredit: false, idempotencyKey: `task-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}` },
  });
  expect(placed.status()).toBe(201);
  const body = (await placed.json()) as { order: { id: string; order_number: string } };
  return { orderId: body.order.id, orderNumber: body.order.order_number };
}

async function apiReturn(page, token: string, orderId: string): Promise<{ returnId: string; returnNumber: string }> {
  const detail = await page.request.get(`/api/v1/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(detail.ok()).toBe(true);
  const orderItemId = ((await detail.json()) as { items: Array<{ id: string }> }).items[0].id;
  const created = await page.request.post('/api/v1/returns', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      orderId,
      items: [{ orderItemId, quantity: 1, reasonCode: 'CHANGED_MIND' }],
      resolutionType: 'REFUND',
      pickupKind: 'PICKUP',
      pickupAddress: 'Home',
    },
  });
  expect(created.status()).toBe(201);
  const body = (await created.json()) as { ret: { id: string; return_number: string } };
  return { returnId: body.ret.id, returnNumber: body.ret.return_number };
}

/** Drive one order→return to IN_TRANSIT through API + scheduler; returns identifiers. */
async function setupTaskReturn(page, tag: string): Promise<{ returnId: string; returnNumber: string }> {
  const session = await apiSignup(page, `taskflow-${tag}`);
  const addressId = await apiAddress(page, session.token);
  const { orderNumber, orderId } = await apiCheckout(page, session.token, addressId);
  await waitForOrderStatus(orderNumber, 'DELIVERED');
  const ret = await apiReturn(page, session.token, orderId);
  await waitForReturnStatus(ret.returnId, 'IN_TRANSIT');
  return ret;
}

async function warehouseLogin(page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill('warehouse@returnos.test');
  await page.getByLabel('Password').fill('Warehouse123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/warehouse(\/.*)?$/);
}

/** Find the RECEIVE_RETURN task row for a return number. */
function taskRow(page, returnNumber: string) {
  return page.locator('tbody tr', { hasText: returnNumber });
}

test('floor tasks: claim, complete, and block with a reason', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'floor task actions run on chromium only');
  test.setTimeout(300_000);

  const first = await setupTaskReturn(page, 'a');
  const second = await setupTaskReturn(page, 'b');

  await warehouseLogin(page);
  await page.goto('/warehouse/tasks');
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible({ timeout: 15000 });

  // Filter to receiving work so the rows under test are unambiguous.
  await page.getByLabel('Filter tasks by kind').selectOption('RECEIVE_RETURN');

  // ---- Claim the first task -------------------------------------------
  const rowA = taskRow(page, first.returnNumber);
  await expect(rowA).toBeVisible({ timeout: 15000 });
  await rowA.getByRole('button', { name: 'Claim' }).click();
  await expect(rowA.getByText('IN PROGRESS')).toBeVisible();
  const assignee = db
    .prepare("SELECT assigned_to FROM warehouse_tasks WHERE title LIKE '%' || ? || '%' AND kind = 'RECEIVE_RETURN' ORDER BY created_at DESC LIMIT 1")
    .get(first.returnNumber) as { assigned_to: string | null };
  expect(assignee.assigned_to).toBe('u-wh-operator');

  // ---- Complete it ------------------------------------------------------
  await rowA.getByRole('button', { name: 'Done' }).click();
  await expect(rowA.getByText('COMPLETED')).toBeVisible();

  // ---- Block the second one: empty reason is refused in the UI ----------
  const rowB = taskRow(page, second.returnNumber);
  await expect(rowB).toBeVisible({ timeout: 15000 });
  await rowB.getByRole('button', { name: 'Block' }).click();
  await rowB.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Give a reason so the next operator knows what is stuck.')).toBeVisible();

  // ---- Block with a reason ----------------------------------------------
  await rowB.getByPlaceholder('Why is it stuck?').fill('Dock door jammed');
  await rowB.getByRole('button', { name: 'Save' }).click();
  await expect(rowB.getByText('BLOCKED')).toBeVisible();
  await expect(rowB.getByText('Dock door jammed')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/tasks-actions.png` });
});
