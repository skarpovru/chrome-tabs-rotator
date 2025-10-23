import { expect, test } from '../utils/extension-fixtures';

// This test exercises the real UI Import flow using a generated JSON config file.
// It ensures the button triggers file selection, config is validated & applied, and table renders pages.

test.describe('UI Local Config File Import', () => {
  test('imports configuration via Import button and renders pages', async ({ ext }) => {
    const { context, extensionId } = ext;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);

    // Ensure UI loaded
    await expect(page.locator('text=Tabs Rotator / Slideshow')).toBeVisible();

    // Ensure we are in local config mode (checkbox / toggle might exist). If remote config is enabled, disable it.
    const remoteToggle = page.locator('input[type="checkbox"][name="useRemoteConfig"], input[data-testid="useRemoteConfig"]');
    if (await remoteToggle.first().isVisible()) {
      const checked = await remoteToggle.first().isChecked().catch(()=>false);
      if (checked) {
        await remoteToggle.first().click();
      }
    }

    // Click Import to trigger file input creation.
    const importBtn = page.getByRole('button', { name: /^Import$/ });
    await expect(importBtn).toBeVisible();
    await importBtn.click();

    // After click, a transient file input should exist. Use locator for any file input.
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveCount(1);

    const config = {
      pages: [
        { url: 'https://playwright.example/a', delaySeconds: 5, reloadIntervalSeconds: 0 },
        { url: 'https://playwright.example/b', delaySeconds: 6, reloadIntervalSeconds: 0 }
      ],
      isFullscreen: false,
      preventWindowFocus: false
    };

    // Provide the JSON file.
    const tmpFileName = 'import-config.json';
    await fileInput.setInputFiles({ name: tmpFileName, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(config, null, 2)) });

    // Wait for table to render imported pages.
  // In local config editor, URLs appear in input values rather than text nodes.
  const editor = page.locator('app-config-editor');
  await expect(editor).toBeVisible({ timeout: 10000 });
  // Fallback: read all text inputs and check their values
  const urls = await page.locator('app-config-editor input[type="text"]').evaluateAll(nodes => nodes.map(n => (n as HTMLInputElement).value));
  expect(urls).toEqual(expect.arrayContaining(['https://playwright.example/a', 'https://playwright.example/b']));
  });

  test('shows validation error for invalid config file', async ({ ext }) => {
    const { context, extensionId } = ext;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(page.locator('text=Tabs Rotator / Slideshow')).toBeVisible();

    const importBtn = page.getByRole('button', { name: /^Import$/ });
    await expect(importBtn).toBeVisible();
    await importBtn.click();
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveCount(1);

    // Invalid: empty pages array & bad URL
    const badConfig = { pages: [{ url: 'ftp://invalid', delaySeconds: 1, reloadIntervalSeconds: -5 }] };
    await fileInput.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(badConfig)) });

    // Expect error message rendered
  const errEl = page.locator('div.text-red-600', { hasText: /Validation failed/ });
    await expect(errEl).toBeVisible({ timeout: 5000 });
    const text = await errEl.textContent();
    expect(text).toMatch(/url must start with http/);
    expect(text).toMatch(/delaySeconds must be ≥ 3/);
    expect(text).toMatch(/reloadIntervalSeconds must be ≥ 0/);
  });
});
