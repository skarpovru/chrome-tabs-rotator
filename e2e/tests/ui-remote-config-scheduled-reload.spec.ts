import { test, expect } from '../utils/extension-fixtures';
import { pollRemoteConfig } from '../utils/storage-helpers';

declare const chrome: any;

// Simulates a scheduled remote reload by evaluating in the service worker to invoke fetchRemoteConfig twice with different responses.
// Assumes rotationService exposes a test-only hook or we monkey patch http client.

test.describe('UI Remote Configuration Scheduled Reload', () => {
  test('scheduled reload updates remoteConfig without manual UI interaction', async ({ ext }) => {
    const { context, extensionId, serviceWorker } = ext;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await page.getByRole('button', { name: 'Switch to Remote Config' }).click();
    const remoteUrl = 'https://remote.test/scheduled.json';
    // First response
    await page.route(remoteUrl, route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pages: [{ url: 'https://remote-scheduled-initial.example', delaySeconds: 5, reloadIntervalSeconds: 0 }] }) });
    });
    await page.locator('#configUrlInput').fill(remoteUrl);
    await page.locator('input[type="number"]').first().fill('0');
    await Promise.all([
      page.waitForResponse(r => r.url() === remoteUrl && r.status() === 200),
      page.getByRole('button', { name: 'Load Config' }).click()
    ]);
    const initial = await pollRemoteConfig(page, cfg => !!cfg && Array.isArray(cfg.pages) && cfg.pages.length === 1);
    expect(initial.pages[0].url).toContain('remote-scheduled-initial');

    // Stub http.get in service worker and invoke reload alarm handler directly
    await serviceWorker.evaluate(async (url: string) => {
      try {
        const rs = (self as any).rotationService;
        if (!rs) return;
        // Inject updated http.get stub
        const http = (rs as any).http;
        if (http) {
          http.get = async () => ({ pages: [
            { url: 'https://remote-scheduled-updated.example', delaySeconds: 5, reloadIntervalSeconds: 0 },
            { url: 'https://remote-scheduled-added.example', delaySeconds: 5, reloadIntervalSeconds: 0 }
          ] });
        }
        // Invoke reload path
        if (typeof (rs as any).onConfigReloadAlarm === 'function') {
          await (rs as any).onConfigReloadAlarm();
        }
      } catch {}
    }, remoteUrl);

    const updated = await pollRemoteConfig(page, cfg => !!cfg && Array.isArray(cfg.pages) && cfg.pages.length === 2 && cfg.pages[0].url.includes('remote-scheduled-updated'));
    expect(updated?.pages?.[0]?.url).toContain('remote-scheduled-updated');
    expect(updated?.pages?.[1]?.url).toContain('remote-scheduled-added');
  });
});
