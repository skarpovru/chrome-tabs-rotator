import { test, expect } from '../utils/extension-fixtures';
import { pollLocalConfig } from '../utils/storage-helpers';
declare const chrome: any;

// Round trip: enter URL without protocol, save, export, clear, re-import exported file succeeds

test.describe('UI Config Import/Export URL Normalization', () => {
  test('Exported config with normalized URL re-imports successfully', async ({ ext }) => {
    const { context, extensionId } = ext;
    // Global stub & enforce local config mode for this test's browser context (prevent leakage from previous remote config tests)
    await context.addInitScript(() => {
      (window as any).__exportCapture = undefined;
      (window as any).saveAs = (blob: Blob) => {
        blob.text().then((t) => { (window as any).__exportCapture = t; console.log('EXPORT_CAPTURE ' + t); });
      };
      try {
        // Force local mode before Angular bootstraps
        chrome.storage.local.set({ UseRemoteConfig: false });
        chrome.storage.local.remove('remoteSettings');
        chrome.storage.local.remove('remoteConfig');
      } catch {}
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    // If app still renders remote mode (due to async race), click switch button
    const switchBtn = page.getByRole('button', { name: 'Switch to Local Config' });
    if (await switchBtn.count()) {
      try { await switchBtn.click(); } catch {}
    }

  // Use initial default page row; fill without protocol
  const urlInput = page.locator('input[placeholder="Enter URL"]').first();
    await urlInput.fill('example.com/path');
    const delayInput = page.locator('input[type="number"]').nth(0);
    await delayInput.fill('5');
    const reloadInput = page.locator('input[type="number"]').nth(1);
    await reloadInput.fill('0');
  const saveBtn = page.getByRole('button', { name: 'Save Configuration' });
  await expect(saveBtn).toBeVisible();
  await saveBtn.click();
  // Wait for localConfig persistence so Export button appears
  await pollLocalConfig(page, cfg => !!cfg && Array.isArray(cfg.pages) && cfg.pages.length > 0);
    // Diagnostic: log any console messages
    page.on('console', msg => {
      // eslint-disable-next-line no-console
      console.log('[page console]', msg.type(), msg.text());
    });

    // Export (stub saveAs to capture blob)
    // Diagnostics: evaluate component state before waiting for Export button
    const diagHasExportable = await page.evaluate(() => {
      try {
        const ngWin: any = window as any;
        // Attempt to locate Angular root component instance if exposed (heuristic)
        return !!(ngWin?.document?.querySelector('app-root'));
      } catch { return 'no-root'; }
    });
    console.log('[diag] root presence before export wait', diagHasExportable);
    // Wait for Export button to appear (hasExportableLocalConfig gating)
  const exportBtn = page.getByRole('button', { name: /^Export$/ });
  // Extra diagnostic: check useRemoteConfig flag in storage
  const useRemoteCfg = await page.evaluate(() => new Promise<any>(resolve => { try { chrome.storage.local.get(['UseRemoteConfig'], (r: any) => resolve(r.UseRemoteConfig)); } catch { resolve('err'); } }));
  console.log('[diag] useRemoteConfig storage value before export wait', useRemoteCfg);
  await expect(exportBtn).toBeVisible({ timeout: 8000 });
    // Diagnostic: confirm storage state right before click
    const cfgBefore = await page.evaluate(() => new Promise<any>(resolve => { try { chrome.storage.local.get(['localConfig'], (r:any) => resolve(r.localConfig)); } catch { resolve(null); } }));
    if (!cfgBefore || !Array.isArray(cfgBefore.pages) || cfgBefore.pages.length === 0) {
      console.log('[diag] localConfig missing pages before export');
    }
    await exportBtn.click();
    const exportedHandle = await page.waitForFunction(() => {
      return (window as any).__exportCapture ? JSON.parse((window as any).__exportCapture) : null;
    }, { timeout: 5000 });
    const exportedObj: any = await exportedHandle.jsonValue();
    expect(exportedObj.pages).toBeTruthy();
    expect(Array.isArray(exportedObj.pages)).toBeTruthy();
    expect(exportedObj.pages[0].url).toMatch(/^https?:\/\//);

    // Clear current config storage then import
    await page.addInitScript(() => {
      try { (chrome.storage as any).local.remove('localConfig'); } catch {}
    });
  // Re-import using captured JSON
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import' }).click();
    const chooser = await fileChooserPromise;
  await chooser.setFiles({ name: 'normalized.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exportedObj, null, 2)) });

    // Expect no importError displayed
    await expect(page.locator('text=Validation failed')).toHaveCount(0);
  await expect(page.locator('input[placeholder="Enter URL"]').first()).toHaveValue(exportedObj.pages[0].url);
  });
});
