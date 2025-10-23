import { test, expect } from '../utils/extension-fixtures';
import { pollRemoteConfig } from '../utils/storage-helpers';
import { expectValidationError } from '../utils/assertion-helpers';

declare const chrome: any;

test.describe('UI Remote Configuration Storage Invalid', () => {
  test('invalid remote configuration does not persist remoteConfig', async ({ ext }) => {
    const { context, extensionId } = ext;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await page.getByRole('button', { name: 'Switch to Remote Config' }).click();
    const remoteUrl = 'https://remote.test/invalid-storage.json';
    await page.route(remoteUrl, route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pages: [{ url: 'ftp://invalid-storage', delaySeconds: 1, reloadIntervalSeconds: 0 }] })
      });
    });
    await page.locator('#configUrlInput').fill(remoteUrl);
    await page.locator('input[type="number"]').first().fill('0');
    await Promise.all([
      page.waitForResponse(r => r.url() === remoteUrl && r.status() === 200),
      page.getByRole('button', { name: 'Load Config' }).click()
    ]);
    // The component should show validation error
  await expectValidationError(page, /Validation failed/);
    // Poll for remoteConfig staying undefined or having zero valid pages
    const cfg = await pollRemoteConfig(page, cfg => cfg === undefined || (Array.isArray(cfg.pages) && cfg.pages.length === 0));
    expect(!cfg || cfg.pages.length === 0).toBeTruthy();
  });
});
