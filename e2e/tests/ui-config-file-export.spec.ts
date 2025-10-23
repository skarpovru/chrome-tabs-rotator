import { test, expect } from '../utils/extension-fixtures';
import { pollLocalConfig } from '../utils/storage-helpers';
import { callE2E as callApi } from '../utils/call-e2e-api';
import { waitForWorkerApi } from '../utils/reliability-helpers';

const config = {
  pages: [
    { url: 'https://export.example/a', delaySeconds: 5, reloadIntervalSeconds: 0 },
    { url: 'https://export.example/b', delaySeconds: 6, reloadIntervalSeconds: 0 }
  ],
  isFullscreen: false,
  preventWindowFocus: false
};

// Test stubs file saving by replacing saveAs with a function that records blob contents.

test.describe('UI Local Config File Export', () => {
  test('exports current local configuration via Export button', async ({ ext }) => {
    const { context, extensionId } = ext;
    await waitForWorkerApi(context);
    // Initialize background with config so UI loads with localConfig populated
    await callApi(context, 'startWithConfig', config);

    const page = await context.newPage();
    // Stub saveAs BEFORE navigation so app uses overridden version
    await page.addInitScript(() => {
      (window as any).__exportCapture = { calls: [] };
      (window as any).saveAs = (blob: Blob, filename: string) => {
        const reader = new FileReader();
        reader.onload = (e: any) => {
          (window as any).__exportCapture.calls.push({ filename, text: e.target.result });
        };
        reader.readAsText(blob);
      };
    });
    await page.goto(`chrome-extension://${extensionId}/index.html`);

    // Ensure local config editor appears
    await expect(page.locator('app-config-editor')).toBeVisible({ timeout: 10000 });

  // Wait for localConfig persisted before clicking Export (flake guard)
  await pollLocalConfig(page, cfg => !!cfg && Array.isArray(cfg.pages) && cfg.pages.length === 2);
  // Click Export (button only visible after localConfig present)
  const exportBtn = page.getByRole('button', { name: /^Export$/ });
  await expect(exportBtn).toBeVisible({ timeout: 5000 });
    await exportBtn.click();

    // Poll capture object for recorded call
    await page.waitForFunction(() => (window as any).__exportCapture.calls.length > 0, { timeout: 5000 });
    const captured = await page.evaluate(() => (window as any).__exportCapture.calls[0]);
    expect(captured.filename).toMatch(/tabs-rotator-config/);
    const parsed = JSON.parse(captured.text);
    expect(parsed.pages.length).toBe(2);
    expect(parsed.pages.map((p: any) => p.url)).toEqual(['https://export.example/a','https://export.example/b']);
    expect(parsed.isFullscreen).toBe(false);
    expect(parsed.preventWindowFocus).toBe(false);
  });
});
