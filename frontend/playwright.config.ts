import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Reset the demo database first, so every run starts from the same seeded
  // baseline instead of whatever the previous run left behind.
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Fail fast on missing/stuck elements: without this, an action waits up
    // to the whole test timeout (observed: 15 min on one disabled button).
    actionTimeout: 20_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] },
    },
  ],
  // Two servers: the API with a fast real fulfillment lifecycle (every stage
  // still written by backend code, just without the demo waiting periods), and
  // the Vite dev server the browser talks to.
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../backend',
      url: 'http://localhost:8080/api/v1/meta/reasons',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        FULFILL_TICK_MS: '500',
        FULFILL_ORDER_MIN_CONFIRMED: '0',
        FULFILL_ORDER_MIN_PROCESSING: '0',
        FULFILL_ORDER_MIN_SHIPPED: '0',
        FULFILL_ORDER_MIN_IN_TRANSIT: '0',
        FULFILL_ORDER_MIN_OUT_FOR_DELIVERY: '0',
        FULFILL_ORDER_MIN_DELIVERED: '0',
        FULFILL_RETURN_MIN_APPROVED: '0',
        FULFILL_RETURN_MIN_PICKED_UP: '0',
        FULFILL_RETURN_MIN_IN_TRANSIT: '0',
        FULFILL_RETURN_MIN_RECEIVED: '0',
        FULFILL_RETURN_MIN_INSPECTION: '0',
        FULFILL_RETURN_MIN_RESOLVED: '0',
      },
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
});