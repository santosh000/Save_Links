import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  webServer: [
    // app suite: dev server, mode 'test' (no service worker)
    {
      command: 'npx vite --mode test',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60 * 1000,
    },
    // PWA/offline verification: the ACTUAL production build.
    // --host 127.0.0.1 + IPv4 literals: `vite preview` binds IPv4 only, and
    // Playwright resolves `localhost` to ::1 -> connection refused.
    {
      command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
  ],
  projects: [
    {
      // existing app suite, dev server, mode 'test' (no service worker)
      name: 'chromium',
      testIgnore: /pwa\.spec\.js/,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
    {
      // PWA/offline verification against the production build on :4173
      name: 'pwa',
      testMatch: /pwa.*\.spec\.js/,
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        baseURL: 'http://127.0.0.1:4173',
      },
    },
  ],
})