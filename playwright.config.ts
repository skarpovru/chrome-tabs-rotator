import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: path.join(__dirname, 'e2e', 'tests'),
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // Limit global workers to reduce concurrent Chromium instances (resource stability)
  workers: 4,
  reporter: [['list']],
  use: {
    headless: false, // extensions require headful Chromium
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium-light',
      testMatch: /.*\.spec\.ts/,
      grepInvert: /@heavy/,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'chromium-heavy',
      grep: /@heavy/,
      // Force single worker for heavy specs to reduce peak resource usage
      workers: 1,
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
