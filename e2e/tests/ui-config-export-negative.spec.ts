import { test, expect } from '../utils/extension-fixtures';
import { pollLocalConfig } from '../utils/storage-helpers';
// MV3 global chrome declared for TS
declare const chrome: any;

// Verifies Export button is hidden when no localConfig yet (fresh load / no stored config).

test.describe('UI Local Config Export Visibility', () => {
  test('Export button hidden until first valid URL saved', async ({ ext }) => {
    const { context, extensionId } = ext;
    const page = await context.newPage();
    // Force local config mode to avoid leakage from remote config tests
    await page.addInitScript(() => {
      try {
        chrome.storage.local.set({ UseRemoteConfig: false });
        chrome.storage.local.remove('remoteSettings');
        chrome.storage.local.remove('remoteConfig');
      } catch {}
    });
    await page.addInitScript(() => {
      try { (chrome.storage as any).local.remove('localConfig'); } catch {}
    });
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    // Wait for heading
    await expect(page.locator('text=Tabs Rotator / Slideshow')).toBeVisible();
  // Export hidden initially (no valid URL yet) - assert via host attribute as well as button absence.
  await expect(page.getByRole('button', { name: /^Export$/ })).toHaveCount(0);
  const host = page.locator('app-root');
  await expect(host).toHaveAttribute('data-exportable', 'false');
    const urlInput = page.locator('input[placeholder="Enter URL"]').first();
    await urlInput.fill('https://neg-export.example');
    const delayInput = page.locator('input[type="number"]').nth(0);
    await delayInput.fill('5');
    const reloadInput = page.locator('input[type="number"]').nth(1);
    await reloadInput.fill('0');
    const saveBtn = page.getByRole('button', { name: 'Save Configuration' });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();
    // Wait for localConfig persisted (confirm URL stored)
  await pollLocalConfig(page, cfg => !!cfg && Array.isArray(cfg.pages) && cfg.pages.some((p: any) => /neg-export\.example$/.test(p.url)));
    // Additional UI confirmation that editor input reflects saved/normalized URL
    await expect(urlInput).toHaveValue(/https?:\/\/neg-export\.example/);
    // Diagnostics: capture canExportLocalConfig and root HTML snippet
    const diagSnapshot = await page.evaluate(() => {
      try {
        const root = document.querySelector('app-root');
        const htmlSnippet = root ? root.innerHTML.slice(0, 800) : 'no-root';
        // Attempt to access component instance via Angular debugging APIs if present
        return { htmlSnippet };
      } catch (e) { return { error: String(e) }; }
    });
    console.log('[diag-export-negative] root snippet', JSON.stringify(diagSnapshot));
    const flagVal = await page.evaluate(() => {
      try {
        // Heuristic: read canExportLocalConfig from a data attribute if we expose it (not yet exposed)
        return (window as any).__canExportFlag ?? 'unknown';
      } catch { return 'err'; }
    });
    console.log('[diag-export-negative] flag heuristic', flagVal);
    // Wait for host attribute to flip to true (indicates gating ready)
    await expect(host).toHaveAttribute('data-exportable', 'true');
    // Once attribute is true, the button should materialize quickly.
    const exportLocator = page.locator('[data-testid="export-config-btn"]');
    await expect(exportLocator).toBeVisible({ timeout: 2000 });
  });
});
