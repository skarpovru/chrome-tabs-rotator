import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E } from '../utils/call-e2e-api';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';

/**
 * Large ordering preservation test (15 pages)
 * -----------------------------------------
 * Ensures deterministic order scales and remains stable after rotations, missing page recovery and reload alarms.
 */

test.describe('Ordering preservation (large)', () => {
  test('15-page order remains stable', async ({ ext }) => {
    const { context } = ext;
    await waitForWorkerApi(context);

    const pages = Array.from({ length: 15 }, (_, i) => ({
      url: `https://example.com/page-${i+1}`,
      delaySeconds: (i % 4) + 2,
      reloadIntervalSeconds: (i % 5) ? 0 : 11
    }));

    const cfg: any = { pages, isFullscreen: false, preventWindowFocus: false };
    await callE2E(context, 'startWithConfig', cfg);
    await waitForTabIds(context, pages.length);

    const orderedUrlsResp: any = await callE2E(context, 'getOrderedUrls');
    expect(orderedUrlsResp.ok).toBeTruthy();
    const initialOrder = orderedUrlsResp.urls;
    expect(initialOrder).toEqual(pages.map(p => p.url));

    // Drive multiple rotations
    for (let i = 0; i < 25; i++) {
      await callE2E(context, 'rotateOnce');
      if (i % 6 === 5) await callE2E(context, 'advanceIndex');
      await new Promise(r => setTimeout(r, 120));
    }

    // Remove three non-current pages to exercise rebuild logic
    const state: any = await callE2E(context, 'getState');
    const ci = state?.currentIndex ?? state?.rotationState?.currentIndex ?? 0;
    const victims = [ (ci + 3) % pages.length, (ci + 7) % pages.length, (ci + 11) % pages.length ];
    for (const v of victims) await callE2E(context, 'makePageMissing', v);
    await callE2E(context, 'rotateOnce');

    // Wait for recovery
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const tabsCfg: any = await callE2E(context, 'getTabsConfig');
      const allRecovered = victims.every(v => tabsCfg.tabs[v]?.tabId > 0);
      if (allRecovered) break;
      await new Promise(r => setTimeout(r, 200));
    }

    // Fetch canonical ordered URLs again
    const finalOrderedResp: any = await callE2E(context, 'getOrderedUrls');
    expect(finalOrderedResp.ok).toBeTruthy();
    expect(finalOrderedResp.urls).toEqual(initialOrder);

    await context.close();
  });
});
