import { Page, expect } from '@playwright/test';

// Centralized UI assertion helpers.
// Error messages use tailwind class text-red-500.

export async function expectValidationError(page: Page, pattern: RegExp | string) {
  const matcher = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
  await page.waitForSelector('div.text-red-500');
  const errorLoc = page.locator('div.text-red-500').filter({ hasText: matcher });
  await expect(errorLoc).toBeVisible();
}
