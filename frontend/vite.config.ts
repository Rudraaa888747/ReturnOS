import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Dev: Vite serves :5173 and proxies /api to the Spring Boot backend (:8080).
// Prod: set VITE_API_URL to the API origin; the bundle itself is static.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
})
