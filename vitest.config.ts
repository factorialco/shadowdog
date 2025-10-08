import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Exclude E2E and integration tests from unit test runs
    exclude: ['**/node_modules/**', '**/dist/**', '**/test/e2e/**', '**/test/integration/**'],
    // Include unit test files co-located with source code
    include: ['src/**/*.test.ts', 'src/**/*.test.js'],
  },
})
