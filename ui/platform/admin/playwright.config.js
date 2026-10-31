import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  reporter: 'list',
  outputDir: './test-results',
  use: {
    baseURL: process.env.ADMIN_TEST_URL || 'http://127.0.0.1:3101',
    ...(process.env.ADMIN_BROWSER_CHANNEL ? { channel: process.env.ADMIN_BROWSER_CHANNEL } : {}),
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
