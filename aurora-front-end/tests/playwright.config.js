// @aurora/e2e — Playwright configuration for end-to-end tests
import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.AURORA_BASE_URL || 'http://localhost:3003';

export default defineConfig({
  testDir: './e2e',
  timeout: 300_000,        // 5 min per test (agent jobs can take a while)
  expect: { timeout: 15_000 },
  fullyParallel: false,     // Agent jobs share workspace — serialize
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: { headless: true },
      },
    },
  ],
});
