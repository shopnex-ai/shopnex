import { defineConfig } from '@playwright/test'

// Browser tests against a running app and storefront (`pnpm dev`, or the CI job's built servers).
// Failures keep a trace, screenshot and video; no retries, so a flaky test shows up instead of hiding.
export default defineConfig({
  testDir: 'browser',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
