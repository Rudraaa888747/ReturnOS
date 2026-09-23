import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Warehouse floor at four widths: 1440 / 1280 / 1024 / 768.
// Asserts every page renders its heading, never scrolls sideways, and shots
// each viewport for the visual record. Chromium-only: layout, not engines.
// ---------------------------------------------------------------------------

const SHOTS = 'e2e/screenshots';

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1280', width: 1280, height: 800 },
  { name: '1024', width: 1024, height: 768 },
  { name: '768', width: 768, height: 1024 },
] as const;

const PAGES = [
  { path: '/warehouse', heading: 'Dashboard', shot: 'responsive-dashboard' },
  { path: '/warehouse/returns', heading: 'Return queue', shot: 'responsive-queue' },
  { path: '/warehouse/inventory', heading: 'Inventory', shot: 'responsive-inventory' },
  { path: '/warehouse/tasks', heading: 'Tasks', shot: 'responsive-tasks' },
  { path: '/warehouse/analytics', heading: 'Analytics', shot: 'responsive-analytics' },
] as const;

test.describe('warehouse responsive layouts', () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'viewport matrix runs on chromium only');
    await page.goto('/login');
    await page.getByLabel('Email').fill('warehouse@returnos.test');
    await page.getByLabel('Password').fill('Warehouse123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/warehouse(\/.*)?$/);
  });

  for (const viewport of VIEWPORTS) {
    for (const entry of PAGES) {
      test(`${entry.heading} at ${viewport.name}px has no horizontal scroll`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(entry.path);
        await expect(page.getByRole('heading', { name: entry.heading, exact: true })).toBeVisible({
          timeout: 15000,
        });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${entry.path} overflows at ${viewport.width}px`).toBeLessThanOrEqual(1);
        await page.screenshot({ path: `${SHOTS}/${entry.shot}-${viewport.name}.png` });
      });
    }
  }

  test('return file at 768px keeps the workflow usable', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/warehouse/returns');
    const firstReturn = page.locator('tbody tr td a').first();
    await expect(firstReturn).toBeVisible({ timeout: 15000 });
    await firstReturn.click();
    await expect(page.getByLabel('Workflow progress')).toBeVisible({ timeout: 15000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'return file overflows at 768px').toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${SHOTS}/responsive-detail-768.png`, fullPage: true });
  });
});
