import { test, expect } from '../utils/extension-fixtures';
declare const chrome: any;

// Round trip: enter URL without protocol, save, export, clear, re-import exported file succeeds

test.describe('UI Config Import/Export URL Normalization', () => {
  test('Exported config with normalized URL re-imports successfully', async ({ ext }) => {
    const { context, extensionId } = ext;
    // Global stub for this test's browser context
    await context.addInitScript(() => {
      (window as any).__exportCapture = undefined;
      (window as any).saveAs = (blob: Blob) => {
        blob.text().then((t) => { (window as any).__exportCapture = t; console.log('EXPORT_CAPTURE ' + t); });
      };
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);

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
    // Diagnostic: log any console messages
    page.on('console', msg => {
      // eslint-disable-next-line no-console
      console.log('[page console]', msg.type(), msg.text());
    });

    // Export (stub saveAs to capture blob)
    // Click export then poll for captured text instead of relying solely on console event.
    await page.getByRole('button', { name: /^Export$/ }).click();
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
