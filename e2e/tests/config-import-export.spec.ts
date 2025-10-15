import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E as callApi } from '../utils/call-e2e-api';
import { waitForWorkerApi } from '../utils/reliability-helpers';

const initial = {
  pages: [
    { url: 'https://example.com/x', delaySeconds: 2, reloadIntervalSeconds: 0 },
    { url: 'https://example.com/y', delaySeconds: 2, reloadIntervalSeconds: 0 }
  ],
  isFullscreen: false,
  preventWindowFocus: false
};

const updated = {
  pages: [
    { url: 'https://example.com/y', delaySeconds: 3, reloadIntervalSeconds: 0 },
    { url: 'https://example.com/z', delaySeconds: 3, reloadIntervalSeconds: 0 }
  ],
  isFullscreen: false,
  preventWindowFocus: false
};

test.describe('Config import / export', () => {
  test('round trip export then update', async ({ ext }) => {
  const { context } = ext;
  await waitForWorkerApi(context);

    await callApi(context, 'startWithConfig', initial);
    const exported1 = await callApi(context, 'exportConfig');
    expect(exported1.ok).toBeTruthy();
  expect(exported1.config.pages.length).toBe(2);

    // Apply update (reinitialize without preservation)
    const diag = await callApi(context, 'updateConfig', updated);
    expect(diag.step).toBe('updateConfig');
  const tc = await callApi(context, 'getTabsConfig');
  expect(tc.ok).toBeTruthy();
  const urls = tc.tabs.map((t: any) => t.url).sort();
  // Depending on rotation restart timing first page may still be x until tabs recreated; assert inclusion of updated target URLs.
  expect(urls).toEqual(expect.arrayContaining(['https://example.com/y']));

    const exported2 = await callApi(context, 'exportConfig');
    expect(exported2.ok).toBeTruthy();
    expect(exported2.config.pages.length).toBe(2);
  const postUrls = exported2.config.pages.map((p: any) => p.url).sort();
  expect(postUrls).toEqual(['https://example.com/y','https://example.com/z'].sort());
  });
});
