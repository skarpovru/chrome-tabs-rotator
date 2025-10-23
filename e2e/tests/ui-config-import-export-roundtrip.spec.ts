import { test, expect } from '../utils/extension-fixtures';
import { pollLocalConfig } from '../utils/storage-helpers';

// Round trip: import config via file, then export and verify exported JSON matches imported.

test.describe('UI Local Config Import/Export Round Trip', () => {
  test('imports then exports identical configuration', async ({ ext }) => {
    const { context, extensionId } = ext;
    const page = await context.newPage();

    // Stub saveAs early to capture export
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
    await expect(page.locator('text=Tabs Rotator / Slideshow')).toBeVisible();

    // Import
    const importBtn = page.getByRole('button', { name: /^Import$/ });
    await importBtn.click();
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveCount(1);

    const importedConfig = {
      pages: [
        { url: 'https://round.example/one', delaySeconds: 5, reloadIntervalSeconds: 0 },
        { url: 'https://round.example/two', delaySeconds: 7, reloadIntervalSeconds: 0 }
      ],
      isFullscreen: false,
      preventWindowFocus: false
    };
    await fileInput.setInputFiles({ name: 'round.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(importedConfig, null, 2)) });

    // Wait for editor to reflect imported config
    await expect(page.locator('app-config-editor')).toBeVisible({ timeout: 10000 });
    const urls = await page.locator('app-config-editor input[type="text"]').evaluateAll(nodes => nodes.map(n => (n as HTMLInputElement).value));
    expect(urls).toEqual(expect.arrayContaining(['https://round.example/one','https://round.example/two']));

  // Wait for localConfig persisted (ensures Export gating stable)
  await pollLocalConfig(page, cfg => !!cfg && Array.isArray(cfg.pages) && cfg.pages.length === 2);
  // Export and capture
  const exportBtn = page.getByRole('button', { name: /^Export$/ });
  await expect(exportBtn).toBeVisible({ timeout: 5000 });
    await exportBtn.click();
    await page.waitForFunction(() => (window as any).__exportCapture.calls.length > 0, { timeout: 5000 });
    const captured = await page.evaluate(() => (window as any).__exportCapture.calls[0]);
    const parsed = JSON.parse(captured.text);
    expect(parsed.pages.length).toBe(2);
    expect(parsed.pages.map((p: any) => p.url)).toEqual(['https://round.example/one','https://round.example/two']);
    expect(parsed.isFullscreen).toBe(false);
    expect(parsed.preventWindowFocus).toBe(false);
  });
});
