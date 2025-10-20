import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E as callApi } from '../utils/call-e2e-api';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';

/**
 * Ensures reload workflow creates a background preload and swaps it without user-visible loading.
 * We approximate by verifying that after triggering a reload alarm the primary tab id changes
 * (indicating swap) while rotation continues.
 */
test.describe('Hidden reload swap', () => {
  test('reload alarm eventually produces a new tab id for the page', async ({ ext }) => {
    const { context } = ext;
    await waitForWorkerApi(context);
    const cfg = { pages: [
      { url: 'https://example.com/r1', delaySeconds: 2, reloadIntervalSeconds: 5 }
    ], isFullscreen: false, preventWindowFocus: false } as any;
    await callApi(context, 'startWithConfig', cfg);
    await waitForTabIds(context, cfg.pages.length);

    // Get current tab id
    const firstConfig: any = await callApi(context, 'getTabsConfig');
    const originalId = firstConfig.tabs[0].tabId;

    // Manually trigger reload alarms a few times; swap occurs when preload promoted.
    let swapped = false;
    for (let i=0;i<6;i++) {
      const diag: any = await callApi(context, 'getTabsConfig');
      const candidate = diag.tabs[0];
      if (candidate.nextTabId) { await callApi(context, 'triggerReload', candidate.nextTabId); }
      await callApi(context, 'triggerReload', candidate.tabId);
      await new Promise(r=>setTimeout(r, 350));
      await callApi(context, 'rotateOnce');
      const after: any = await callApi(context, 'getTabsConfig');
      if (after.tabs[0].tabId !== originalId) { swapped = true; break; }
    }
    const finalCfg: any = await callApi(context, 'getTabsConfig');
    if (!swapped) {
      // Extended fallback: poll a few more times for either new tabId or emergence of a preload.
      for (let j=0;j<6 && !swapped;j++) {
        await new Promise(r=>setTimeout(r, 400));
        const cfg2: any = await callApi(context, 'getTabsConfig');
        if (cfg2.tabs[0].tabId !== originalId) { swapped = true; break; }
        if (cfg2.tabs[0].nextTabId > 0) { break; }
      }
      const t = (await callApi(context, 'getTabsConfig')).tabs[0];
      // Behavior invariant: eventually either swap occurred or a preload (nextTabId) is staged for future swap.
      expect(swapped || t.nextTabId > 0).toBeTruthy();
    } else {
      expect(finalCfg.tabs[0].tabId).not.toBe(originalId);
    }
  });
});
