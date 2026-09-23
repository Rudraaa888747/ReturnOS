import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Dev: Vite serves :5173 and proxies /api to the Express backend (:8080).
// Prod: set VITE_API_URL to the API origin; the bundle itself is static.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
    // Test artifacts churn under the project root while suites run. Reloading
    // the app for those writes drops authenticated pages mid-test, so they
    // are invisible to the watcher.
    watch: {
      ignored: ['**/test-results/**', '**/playwright-report/**', '**/e2e/screenshots/**'],
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Playwright owns ./e2e; vitest must not collect those specs.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
})
