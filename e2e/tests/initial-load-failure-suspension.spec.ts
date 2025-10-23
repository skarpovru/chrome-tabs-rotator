import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E as callApi } from '../utils/call-e2e-api';
import { waitForWorkerApi } from '../utils/reliability-helpers';

/**
 * Verifies that a primary page encountering an initial load error is immediately marked suspended
 * (independent of retry policy) and later cleared after a synthetic success.
 */
 test.describe('Initial load failure suspension', () => {
  test('suspends then clears after synthetic success', async ({ ext }) => {
    const { context } = ext;
    await waitForWorkerApi(context);
    // Use a stable, globally resolvable domain for the first page so at least one tabId materializes.
    // Keep the second page unreachable to exercise initial load failure + suspension path.
    const failingUrl = 'https://init-fail-b.example';
    const stableUrl = 'https://example.com';
    const cfg: any = { pages: [
      { url: stableUrl, delaySeconds: 2, reloadIntervalSeconds: 0 },
      { url: failingUrl, delaySeconds: 2, reloadIntervalSeconds: 0 }
    ], isFullscreen: false, preventWindowFocus: false };
    await callApi(context, 'startWithConfig', cfg);

    // Custom polling: wait for both page entries to appear; ensure the stable page gains a tabId.
    let entriesReady = false; let stableTabMaterialized = false; let tabsSnap: any = null;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && (!entriesReady || !stableTabMaterialized)) {
      tabsSnap = await callApi(context, 'getTabsConfig');
      const stableEntry = tabsSnap?.tabs?.find((t: any) => t.url === stableUrl);
      const failingEntry = tabsSnap?.tabs?.find((t: any) => t.url === failingUrl);
      entriesReady = !!(stableEntry && failingEntry);
      stableTabMaterialized = entriesReady && stableEntry.tabId > 0;
      if (!stableTabMaterialized && entriesReady) {
        // Help materialization if network slow: inject synthetic success for stable page.
        await callApi(context, 'triggerPrimarySuccessForUrl', { url: stableUrl });
      }
      if (!entriesReady || !stableTabMaterialized) await new Promise(r => setTimeout(r, 250));
    }
    if (!entriesReady) throw new Error('Page entries did not materialize');
    if (!stableTabMaterialized) throw new Error('Stable page did not acquire a tabId');

    // Trigger synthetic error for failing page before any success injected for it.
    await callApi(context, 'triggerPrimaryErrorForUrl', { url: failingUrl });

    const snap1: any = await callApi(context, 'getTabsConfig');
    const failingEntry1 = snap1.tabs.find((t: any)=>t.url===failingUrl);
    expect(failingEntry1?.suspended).toBeTruthy();
    expect(failingEntry1?.primaryCompleteObserved).toBeFalsy();

    // Now simulate successful load which should clear suspension.
    await callApi(context, 'triggerPrimarySuccessForUrl', { url: failingUrl });
    const snap2: any = await callApi(context, 'getTabsConfig');
    const failingEntry2 = snap2.tabs.find((t: any)=>t.url===failingUrl);
    expect(failingEntry2?.suspended).toBeFalsy();
  });
});
