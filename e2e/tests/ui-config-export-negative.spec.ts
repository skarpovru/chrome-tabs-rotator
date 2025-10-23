import { test, expect } from '../utils/extension-fixtures';
// MV3 global chrome declared for TS
declare const chrome: any;

// Verifies Export button is hidden when no localConfig yet (fresh load / no stored config).

test.describe('UI Local Config Export Visibility', () => {
  test('Export button hidden until first valid URL saved', async ({ ext }) => {
    const { context, extensionId } = ext;
    const page = await context.newPage();
    await page.addInitScript(() => {
      try { (chrome.storage as any).local.remove('localConfig'); } catch {}
    });
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    // Wait for heading
    await expect(page.locator('text=Tabs Rotator / Slideshow')).toBeVisible();
    // Export hidden initially (no valid URL yet)
    await expect(page.getByRole('button', { name: /^Export$/ })).toHaveCount(0);
    const urlInput = page.locator('input[placeholder="Enter URL"]').first();
    await urlInput.fill('https://neg-export.example');
    const delayInput = page.locator('input[type="number"]').nth(0);
    await delayInput.fill('5');
    const reloadInput = page.locator('input[type="number"]').nth(1);
    await reloadInput.fill('0');
    const saveBtn = page.getByRole('button', { name: 'Save Configuration' });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();
    // Export button appears after save
    await expect(page.getByRole('button', { name: /^Export$/ })).toBeVisible({ timeout: 5000 });
  });
});
