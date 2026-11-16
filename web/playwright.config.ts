import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke test against the running dev stack (`npm run dev` + seeded catalog).
 * E2E_PHONE / E2E_PASSWORD: a customer account on that stack.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
});
