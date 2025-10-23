import { test, expect } from '../utils/extension-fixtures';
import { pollRemoteConfig } from '../utils/storage-helpers';
import { expectValidationError } from '../utils/assertion-helpers';
// Declare chrome for TS since Playwright test context injects extension APIs in page.evaluate
declare const chrome: any;

test.describe('UI Remote Configuration', () => {
  test('loads valid remote configuration', async ({ ext }) => {
    const { context, extensionId } = ext;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    // Switch to remote config
    await page.getByRole('button', { name: 'Switch to Remote Config' }).click();
    // Intercept remote URL
    const remoteUrl = 'https://remote.test/config.json';
    await page.route(remoteUrl, route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pages: [{ url: 'https://remote-a.example', delaySeconds: 5, reloadIntervalSeconds: 0 }], isFullscreen: false })
      });
    });
    await page.locator('#configUrlInput').fill(remoteUrl);
    await page.locator('input[type="number"]').first().fill('0'); // reload interval minutes
    await Promise.all([
      page.waitForResponse(r => r.url() === remoteUrl && r.status() === 200),
      page.getByRole('button', { name: 'Load Config' }).click()
    ]);
    // Wait until remoteConfig stored
    await page.waitForFunction(() => {
      return new Promise<boolean>(resolve => {
        try {
          chrome.storage.local.get(['remoteConfig'], (res: any) => {
            const cfg = res['remoteConfig'];
            resolve(!!cfg && Array.isArray(cfg.pages) && cfg.pages.length === 1);
          });
        } catch { resolve(false); }
      });
    });
    // Assert storage state for remoteConfig instead of relying on table rendering timing
    const storedFirst = await pollRemoteConfig(page, cfg => !!cfg && Array.isArray(cfg.pages) && cfg.pages.length === 1);
    expect(storedFirst?.pages?.length).toBe(1);
    expect(storedFirst?.pages?.[0]?.url).toBe('https://remote-a.example');
  });

  test('shows validation error for invalid remote configuration', async ({ ext }) => {
    const { context, extensionId } = ext;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await page.getByRole('button', { name: 'Switch to Remote Config' }).click();
    const remoteUrl = 'https://remote.test/bad.json';
    await page.route(remoteUrl, route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pages: [{ url: 'ftp://invalid', delaySeconds: 1, reloadIntervalSeconds: 0 }] })
      });
    });
    await page.locator('#configUrlInput').fill(remoteUrl);
    await page.locator('input[type="number"]').first().fill('0');
    await page.getByRole('button', { name: 'Load Config' }).click();
  await expectValidationError(page, /Validation failed/);
  });

  test('shows network error for missing remote configuration', async ({ ext }) => {
    const { context, extensionId } = ext;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await page.getByRole('button', { name: 'Switch to Remote Config' }).click();
    const remoteUrl = 'https://remote.test/missing.json';
    await page.route(remoteUrl, route => {
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' });
    });
    await page.locator('#configUrlInput').fill(remoteUrl);
    await page.locator('input[type="number"]').first().fill('0');
    await page.getByRole('button', { name: 'Load Config' }).click();
  await expectValidationError(page, /File not found/);
  });

  test('manual reload reflects updated remote configuration', async ({ ext }) => {
    const { context, extensionId } = ext;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await page.getByRole('button', { name: 'Switch to Remote Config' }).click();
    const remoteUrl = 'https://remote.test/dynamic.json';
    let call = 0;
    await page.route(remoteUrl, route => {
      call++;
      if (call === 1) {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pages: [{ url: 'https://remote-first.example', delaySeconds: 5, reloadIntervalSeconds: 0 }] }) });
      } else {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pages: [{ url: 'https://remote-second.example', delaySeconds: 5, reloadIntervalSeconds: 0 }, { url: 'https://remote-second-2.example', delaySeconds: 5, reloadIntervalSeconds: 0 }] }) });
      }
    });
    await page.locator('#configUrlInput').fill(remoteUrl);
    await page.locator('input[type="number"]').first().fill('0');
    await Promise.all([
      page.waitForResponse(r => r.url() === remoteUrl && r.status() === 200),
      page.getByRole('button', { name: 'Load Config' }).click()
    ]);
    await page.waitForFunction(() => {
      return new Promise<boolean>(resolve => {
        try {
          chrome.storage.local.get(['remoteConfig'], (res: any) => {
            const cfg = res['remoteConfig'];
            resolve(!!cfg && Array.isArray(cfg.pages) && cfg.pages.length === 1 && cfg.pages[0].url.includes('remote-first'));
          });
        } catch { resolve(false); }
      });
    });
    const storedInitial = await pollRemoteConfig(page, cfg => !!cfg && Array.isArray(cfg.pages) && cfg.pages.length === 1 && cfg.pages[0].url.includes('remote-first'));
    expect(storedInitial?.pages?.length).toBe(1);
    expect(storedInitial?.pages?.[0]?.url).toContain('remote-first');
    // Click Load Config again to simulate manual reload
    await Promise.all([
      page.waitForResponse(r => r.url() === remoteUrl && r.status() === 200),
      page.getByRole('button', { name: 'Load Config' }).click()
    ]);
    await page.waitForFunction(() => {
      return new Promise<boolean>(resolve => {
        try {
          chrome.storage.local.get(['remoteConfig'], (res: any) => {
            const cfg = res['remoteConfig'];
            resolve(!!cfg && Array.isArray(cfg.pages) && cfg.pages.length === 2 && cfg.pages[0].url.includes('remote-second'));
          });
        } catch { resolve(false); }
      });
    });
    const storedReloaded = await pollRemoteConfig(page, cfg => !!cfg && Array.isArray(cfg.pages) && cfg.pages.length === 2 && cfg.pages[0].url.includes('remote-second'));
    expect(storedReloaded?.pages?.length).toBe(2);
    expect(storedReloaded?.pages?.[0]?.url).toContain('remote-second');
  });
});
