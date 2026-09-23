import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Phase 9 — admin navigation tree.
//
// Every admin page is opened in a real browser and checked for a heading, no
// console errors, and no failed API calls. Detail pages are reached by
// clicking a real row rather than by a hand-built URL, so a broken link is a
// failure here rather than something only found by hand.
// ---------------------------------------------------------------------------

const SHOTS = 'e2e/screenshots';

/** Console noise that does not indicate a broken page. */
function isRealProblem(text: string): boolean {
  return !/favicon|React DevTools|react-devtools/i.test(text);
}

interface Problems {
  console: string[];
  network: string[];
}

function watch(page: Page): Problems {
  const problems: Problems = { console: [], network: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error' && isRealProblem(msg.text())) {
      problems.console.push(msg.text());
    }
  });
  page.on('pageerror', (err) => problems.console.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    // 4xx on an admin API call means the page asked for something it should
    // not have, or asked wrongly; both are defects worth failing on.
    if (res.url().includes('/api/v1/') && res.status() >= 400) {
      problems.network.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });
  return problems;
}

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@returnos.test');
  await page.getByLabel('Password').fill('Admin123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin(\/.*)?$/);
}

/** Every page reachable from the admin nav, in nav order. */
const NAV_PAGES = [
  { path: '/admin', shot: 'admin-dashboard' },
  { path: '/admin/customers', shot: 'admin-customers' },
  { path: '/admin/orders', shot: 'admin-orders' },
  { path: '/admin/returns', shot: 'admin-returns' },
  { path: '/admin/warehouses', shot: 'admin-warehouses' },
  { path: '/admin/workload', shot: 'admin-workload' },
  { path: '/admin/inventory', shot: 'admin-inventory' },
  { path: '/admin/analytics', shot: 'admin-analytics' },
  { path: '/admin/products', shot: 'admin-products' },
  { path: '/admin/categories', shot: 'admin-categories' },
  { path: '/admin/credit', shot: 'admin-credit' },
  { path: '/admin/refunds', shot: 'admin-refunds' },
  { path: '/admin/settings', shot: 'admin-settings' },
  { path: '/admin/support', shot: 'admin-support' },
  { path: '/admin/notifications', shot: 'admin-notifications' },
  { path: '/admin/reports', shot: 'admin-reports' },
  { path: '/admin/accounts', shot: 'admin-accounts' },
  { path: '/admin/audit', shot: 'admin-audit' },
] as const;

test.describe('admin navigation', () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== 'chromium', 'nav walkthrough runs on chromium only');
  });

  test('every nav page renders cleanly', async ({ page }) => {
    test.setTimeout(180_000);
    const problems = watch(page);
    await loginAsAdmin(page);

    for (const entry of NAV_PAGES) {
      await page.goto(entry.path);
      await expect(page.locator('h1').first(), `no heading on ${entry.path}`).toBeVisible();
      // The shell must survive: a crashed render loses the nav.
      await expect(page.locator('nav a[href="/admin/returns"]').first()).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/${entry.shot}.png`, fullPage: true });
    }

    expect(problems.network, 'failed API calls during nav walkthrough').toEqual([]);
    expect(problems.console, 'console errors during nav walkthrough').toEqual([]);
  });

  test('nav links actually navigate', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);

    // Click each nav link rather than visiting its href, so a mis-wired link
    // fails here.
    for (const entry of NAV_PAGES) {
      const link = page.locator(`nav a[href="${entry.path}"]`).first();
      await expect(link, `nav is missing a link to ${entry.path}`).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${entry.path.replace(/\//g, '\\/')}$`));
      await expect(page.locator('h1').first()).toBeVisible();
    }
  });

  test('detail pages open from their list rows', async ({ page }) => {
    test.setTimeout(180_000);
    const problems = watch(page);
    await loginAsAdmin(page);

    const details = [
      { list: '/admin/customers', hrefPrefix: '/admin/customers/', shot: 'admin-customer-detail' },
      { list: '/admin/orders', hrefPrefix: '/admin/orders/', shot: 'admin-order-detail' },
      { list: '/admin/returns', hrefPrefix: '/admin/returns/', shot: 'admin-return-detail' },
      { list: '/admin/warehouses', hrefPrefix: '/admin/warehouses/', shot: 'admin-warehouse-detail' },
      { list: '/admin/products', hrefPrefix: '/admin/products/', shot: 'admin-product-detail' },
    ] as const;

    for (const entry of details) {
      await page.goto(entry.list);
      const row = page.locator(`a[href^="${entry.hrefPrefix}"]`).first();
      const count = await page.locator(`a[href^="${entry.hrefPrefix}"]`).count();
      if (count === 0) {
        // No seeded record for this list: record it rather than silently skip.
        test.info().annotations.push({ type: 'no-data', description: entry.list });
        continue;
      }
      await row.click();
      await expect(page).toHaveURL(new RegExp(entry.hrefPrefix.replace(/\//g, '\\/')));
      await expect(page.locator('h1').first()).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/${entry.shot}.png`, fullPage: true });
    }

    expect(problems.network, 'failed API calls on detail pages').toEqual([]);
    expect(problems.console, 'console errors on detail pages').toEqual([]);
  });

  test('a customer cannot reach the admin area in the browser', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('rudrachokshi441@gmail.com');
    await page.getByLabel('Password').fill('123456');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/customer(\/.*)?$/);

    await page.goto('/admin');
    // The guard must not leave them sitting on an admin shell.
    await expect(page).not.toHaveURL(/\/admin$/);
  });
});
