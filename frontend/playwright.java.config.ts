import { defineConfig, devices } from '@playwright/test';

// Java-backend target: same specs, same baseURL, but the API is served by
// backend-java (Spring Boot + PostgreSQL, Flyway-seeded incl. V7 demo data)
// instead of the Node/SQLite backend. No globalSetup: the Java database is
// reset by recreating returnos_e2e before the run (see ROUTE_PARITY.md).
// Existing specs are NOT modified; SQLite-coupled specs
// (customer-journey, admin-cross-system, admin-responsive,
// warehouse-tasks-actions) cannot run here by design.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
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
  webServer: [
    {
      command: 'java -jar ../backend-java/target/returnos-backend-1.0.0.jar',
      url: 'http://localhost:8080/api/v1/meta/reasons',
      reuseExistingServer: !process.env.CI,
      timeout: 180000,
      env: {
        DATABASE_URL: 'jdbc:postgresql://localhost:5433/returnos_e2e',
        DATABASE_USERNAME: 'test',
        DATABASE_PASSWORD: 'test',
        JWT_SECRET: 'e2e-test-secret-with-at-least-thirty-two-characters',
        PORT: '8080',
        RETURNOS_FULFILL_TICK_MS: '1000',
        FULFILL_ORDER_MIN_CONFIRMED: '0',
        FULFILL_ORDER_MIN_PROCESSING: '0',
        FULFILL_ORDER_MIN_SHIPPED: '0',
        FULFILL_ORDER_MIN_IN_TRANSIT: '0',
        FULFILL_ORDER_MIN_OUT_FOR_DELIVERY: '0',
        FULFILL_ORDER_MIN_DELIVERED: '0',
        FULFILL_RETURN_MIN_APPROVED: '0',
        FULFILL_RETURN_MIN_PICKED_UP: '0',
        FULFILL_RETURN_MIN_IN_TRANSIT: '0',
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
