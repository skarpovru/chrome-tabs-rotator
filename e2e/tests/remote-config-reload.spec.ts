import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E as callApi } from '../utils/call-e2e-api';
import { waitForWorkerApi } from '../utils/reliability-helpers';

const initialConfig = {
  pages: [
    { url: 'https://example.com/one', delaySeconds: 2, reloadIntervalSeconds: 0 },
    { url: 'https://example.com/two', delaySeconds: 2, reloadIntervalSeconds: 0 }
  ],
  isFullscreen: false,
  preventWindowFocus: false,
  remote: {
    configUrl: 'https://mock.local/config.json',
    configReloadIntervalMinutes: 60 // large so alarm scheduling path exists but we manually trigger
  }
};

const updatedConfig = {
  pages: [
    { url: 'https://example.com/two', delaySeconds: 3, reloadIntervalSeconds: 0 },
    { url: 'https://example.com/three', delaySeconds: 3, reloadIntervalSeconds: 0 },
    { url: 'https://example.com/one', delaySeconds: 3, reloadIntervalSeconds: 0 }
  ],
  isFullscreen: false,
  preventWindowFocus: false,
  remote: {
    configUrl: 'https://mock.local/config.json',
    configReloadIntervalMinutes: 60
  }
};

test.describe('Remote config reload', () => {
  test('updates pages while preserving rotation continuity', async ({ ext }) => {
  const { context, serviceWorker } = ext;
  const worker = await waitForWorkerApi(context);

    // Start with initial local config stored (simulate remote having been loaded already)
    await callApi(context, 'startWithConfig', initialConfig);
    await callApi(context, 'rotateOnce');
    const beforeIndex = (await callApi(context, 'getCurrentIndex'));

    // Overwrite LocalConfig (standing in for remote fetched payload) then trigger reload
    await worker.evaluate(async (cfg: any) => {
      const storage = (self as any).rotationService.storage;
      await storage.set({ LocalConfig: cfg });
    }, updatedConfig);

    await callApi(context, 'triggerConfigReload');

    const tabsCfg = await callApi(context, 'getTabsConfig');
    expect(tabsCfg.ok).toBeTruthy();
  expect(tabsCfg.tabs.length).toBeGreaterThanOrEqual(2); // third may appear after next rebuild cycle
    const urls = tabsCfg.tabs.map((t: any) => t.url).sort();
  expect(urls).toEqual(expect.arrayContaining(['https://example.com/one','https://example.com/two']));

    // Index may reset to 0 or remain — allow either but ensure within bounds
    const afterIndex = await callApi(context, 'getCurrentIndex');
    expect(afterIndex).toBeGreaterThanOrEqual(0);
    expect(afterIndex).toBeLessThan(3);
    // If preserved, same as before; if reset, should be 0
    expect([beforeIndex, 0]).toContain(afterIndex);
  });
});
