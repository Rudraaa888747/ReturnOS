import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'path';

// ---------------------------------------------------------------------------
// Phase 9 — admin layouts at 1440 / 1280 / 1024 / 768.
//
// Asserts each page keeps its heading, never scrolls sideways, and keeps its
// data tables reachable. Chromium only: this is about layout, not engines.
// ---------------------------------------------------------------------------

const SHOTS = 'e2e/screenshots';
const db = new Database(path.resolve(import.meta.dirname, '../../backend/data/returnos.db'));

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1280', width: 1280, height: 800 },
  { name: '1024', width: 1024, height: 768 },
  { name: '768', width: 768, height: 1024 },
] as const;

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@returnos.test');
  await page.getByLabel('Password').fill('Admin123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin(\/.*)?$/);
}

/** Horizontal overflow of the document, in pixels. */
async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe('admin responsive layouts', () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== 'chromium', 'viewport matrix runs on chromium only');
  });

  test('dashboard, customers and a return detail hold up at every width', async ({ page }) => {
    test.setTimeout(240_000);
    await loginAsAdmin(page);

    // A real return, so the detail page is exercised with data rather than an
    // empty state.
    const ret = db.prepare('SELECT id FROM returns ORDER BY created_at DESC LIMIT 1').get() as
      | { id: string }
      | undefined;
    expect(ret, 'a seeded return is needed for the detail layout check').toBeDefined();

    const pages = [
      { path: '/admin', name: 'dashboard' },
      { path: '/admin/customers', name: 'customers' },
      { path: `/admin/returns/${(ret as { id: string }).id}`, name: 'return-detail' },
    ] as const;

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const target of pages) {
        await page.goto(target.path);
        await expect(
          page.locator('h1').first(),
          `${target.name} lost its heading at ${viewport.name}`,
        ).toBeVisible();

        // A couple of pixels of rounding is tolerable; a scrollbar's worth is not.
        const spill = await overflow(page);
        expect(spill, `${target.name} scrolls sideways at ${viewport.name} by ${spill}px`).toBeLessThanOrEqual(2);

        await page.screenshot({
          path: `${SHOTS}/responsive-admin-${target.name}-${viewport.name}.png`,
          fullPage: true,
        });
      }
    }
  });

  test('navigation stays reachable on the narrowest width', async ({ page }) => {
    await loginAsAdmin(page);
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/admin');

    // Either the nav is visible, or there is a control to reveal it. A nav that
    // is neither is unusable at this width.
    const nav = page.locator('nav a[href="/admin/returns"]').first();
    if (!(await nav.isVisible().catch(() => false))) {
      const toggle = page.getByRole('button', { name: /menu|navigation|open/i }).first();
      await expect(toggle, 'no visible nav and no control to open it at 768px').toBeVisible();
      await toggle.click();
      await expect(nav).toBeVisible();
    }
    await page.screenshot({ path: `${SHOTS}/responsive-admin-nav-768.png`, fullPage: true });
  });

  test('wide data tables stay readable rather than spilling the page', async ({ page }) => {
    await loginAsAdmin(page);
    await page.setViewportSize({ width: 1024, height: 768 });

    for (const target of ['/admin/orders', '/admin/inventory', '/admin/audit']) {
      await page.goto(target);
      await expect(page.locator('h1').first()).toBeVisible();
      const spill = await overflow(page);
      expect(spill, `${target} spills the page at 1024px by ${spill}px`).toBeLessThanOrEqual(2);
    }
  });
});
