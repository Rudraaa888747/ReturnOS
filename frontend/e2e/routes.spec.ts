import { test, expect, type Page } from '@playwright/test';

// These specs share the one demo account and mutate its cart, so they run in
// order rather than racing each other for the same server-side state.
test.describe.configure({ mode: 'serial' });

/**
 * Route smoke test: every customer route renders, shows a heading, and logs no
 * console errors or failed requests. Catches dead routes, broken data wiring,
 * and runtime crashes that a type-check cannot see.
 */

const ROUTES = [
  '/customer',
  '/customer/store',
  '/customer/cart',
  '/customer/checkout',
  '/customer/orders',
  '/customer/returns',
  '/customer/returns/new',
  '/customer/track',
  '/customer/notifications',
  '/customer/documents',
  '/customer/addresses',
  '/customer/profile',
  '/customer/settings',
  '/customer/support',
];

const PUBLIC_ROUTES = ['/', '/login', '/signup', '/forgot-password'];

/** Noise that does not indicate a broken page. */
function isRealProblem(text: string): boolean {
  return !/favicon|Download the React DevTools|react-devtools/i.test(text);
}

async function collect(page: Page) {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && isRealProblem(msg.text())) {
      problems.push(`console: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) problems.push(`${res.status()} ${res.url()}`);
  });
  return problems;
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'customer@returnos.test');
  await page.fill('input[type="password"]', 'Customer123');
  await page.click('button:has-text("Sign in")');
  await expect(page).toHaveURL(/\/customer(\/.*)?$/);
}

/**
 * Fresh account per cart run: the demo cart is shared by every project
 * running this file in parallel, so a mutating test must never use it.
 */
async function loginFresh(page: Page): Promise<void> {
  const email = `cart-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
  const signup = await page.request.post('/api/v1/auth/signup', {
    data: { email, password: 'Password123', fullName: 'Cart Customer' },
  });
  expect(signup.ok()).toBe(true);
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', 'Password123');
  await page.click('button:has-text("Sign in")');
  await expect(page).toHaveURL(/\/customer(\/.*)?$/);
}

test('public routes render cleanly', async ({ page }) => {
  const problems = await collect(page);
  for (const route of PUBLIC_ROUTES) {
    await page.goto(route);
    await expect(page.locator('h1').first()).toBeVisible();
  }
  expect(problems).toEqual([]);
});

test('every customer route renders cleanly', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = await collect(page);
  await login(page);

  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.locator('h1').first(), `no heading on ${route}`).toBeVisible();
    // A crashed render would leave the shell without its navigation.
    await expect(page.locator('nav a[href="/customer/orders"]').first()).toBeVisible();
  }
  expect(problems).toEqual([]);
});

test('detail routes render from real records', async ({ page }) => {
  const problems = await collect(page);
  await login(page);

  await page.goto('/customer/orders');
  await page.locator('a[href^="/customer/orders/"]').first().click();
  await expect(page.locator('h1')).toContainText('ORD-');

  await page.goto('/customer/returns');
  await page.locator('a[href^="/customer/returns/"]').first().click();
  await expect(page.locator('h1').first()).toBeVisible();

  await page.goto('/customer/store');
  await page.locator('a[href^="/customer/store/products/"]').first().click();
  await expect(page.locator('h1').first()).toBeVisible();
  // Real catalogue data: a rupee price and a cart action both come from the backend.
  await expect(page.getByText(/₹[\d,]+/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Add to Cart|Out of stock/ }).first()).toBeVisible();

  expect(problems).toEqual([]);
});

test('unknown route shows the not-found page', async ({ page }) => {
  await page.goto('/customer/definitely-not-a-route');
  await expect(page.locator('h1').first()).toBeVisible();
  await page.goto('/totally-unknown');
  await expect(page.locator('h1').first()).toBeVisible();
});

test('cart stays in sync across pages', async ({ page }) => {
  await loginFresh(page);

  // Start from a known-empty cart. The item list must be awaited first: the
  // row count is read after the fetch lands, otherwise an empty snapshot
  // silently keeps stale items and every later assertion drifts.
  await page.goto('/customer/cart');
  await expect(page.locator('h1')).toContainText('Your cart');
  const cartList = page.locator('ul[aria-label="Cart items"]');
  const cartEmpty = page.locator('text=Your cart is empty');
  await expect(cartList.or(cartEmpty).first()).toBeVisible();
  const removeButtons = page.locator('button:has-text("Remove")');
  for (;;) {
    const remaining = await removeButtons.count();
    if (remaining === 0) break;
    await removeButtons.first().click();
    await expect
      .poll(() => removeButtons.count(), { timeout: 10000 })
      .toBeLessThan(remaining);
  }

  await page.goto('/customer/store');
  await page.locator('button:has-text("Add to Cart")').first().click();

  // The store grid swaps the button for a stepper, and the nav badge appears.
  await expect(page.locator('nav a[href="/customer/cart"] span').last()).toHaveText('1');

  // The same quantity is on the cart page, without a manual refresh.
  await page.goto('/customer/cart');
  await expect(page.locator('h1')).toContainText('Your cart');
  await expect(page.locator('nav a[href="/customer/cart"] span').last()).toHaveText('1');

  // Removing it there clears the badge everywhere.
  await page.locator('button:has-text("Remove")').first().click();
  await expect(page.locator('text=Your cart is empty')).toBeVisible();
  await page.goto('/customer/store');
  await expect(page.locator('button:has-text("Add to Cart")').first()).toBeVisible();
});
