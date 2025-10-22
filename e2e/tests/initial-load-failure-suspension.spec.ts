import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E as callApi } from '../utils/call-e2e-api';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';

/**
 * Verifies that a primary page encountering an initial load error is immediately marked suspended
 * (independent of retry policy) and later cleared after a synthetic success.
 */
 test.describe('Initial load failure suspension', () => {
  test('suspends then clears after synthetic success', async ({ ext }) => {
    const { context } = ext;
    await waitForWorkerApi(context);
    const cfg: any = { pages: [
      { url: 'https://init-fail-a.example', delaySeconds: 2, reloadIntervalSeconds: 0 },
      { url: 'https://init-fail-b.example', delaySeconds: 2, reloadIntervalSeconds: 0 }
    ], isFullscreen: false, preventWindowFocus: false };
    await callApi(context, 'startWithConfig', cfg);
    await waitForTabIds(context, cfg.pages.length);

    // Trigger synthetic error for second page primary before any manual success injected
    await callApi(context, 'triggerPrimaryErrorForUrl', { url: cfg.pages[1].url });

    const snap1: any = await callApi(context, 'getTabsConfig');
    const second = snap1.tabs.find((t: any)=>t.url===cfg.pages[1].url);
    expect(second?.suspended).toBeTruthy();

    // Now simulate successful load which should clear suspension
    await callApi(context, 'triggerPrimarySuccessForUrl', { url: cfg.pages[1].url });
    const snap2: any = await callApi(context, 'getTabsConfig');
    const secondAfter = snap2.tabs.find((t: any)=>t.url===cfg.pages[1].url);
    expect(secondAfter?.suspended).toBeFalsy();
  });
});
