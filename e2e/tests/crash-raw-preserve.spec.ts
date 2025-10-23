import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E } from '../utils/call-e2e-api';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';
import { STABLE_DOMAIN_PRIMARY } from '../utils/stable-domains';

/**
 * Raw Crash Recovery Test
 * -------------------
 * Exercises the real background 'crash' path (unhandled exception) and validates tab preservation.
 */
test.describe('Raw crash preserves tabs', () => {
  test('tabs remain after raw crash and rotation continues', async ({ ext }) => {
    const { context } = ext;
    await waitForWorkerApi(context);
    const cfg: any = {
      pages: [
  { url: STABLE_DOMAIN_PRIMARY + '/raw-crash-one', delaySeconds: 1 },
  { url: STABLE_DOMAIN_PRIMARY + '/raw-crash-two', delaySeconds: 1 },
      ],
      isFullscreen: false,
      preventWindowFocus: false
    };
    await callE2E(context, 'startWithConfig', cfg);
  await waitForTabIds(context, cfg.pages.length, 7000, { injectSyntheticSuccess: true });

    // Capture initial tab IDs
    const initialTabsCfg: any = await callE2E(context, 'getTabsConfig');
    const initialTabIds = (initialTabsCfg.tabs || []).map((t: any) => t.tabId).filter(Boolean);
    expect(initialTabIds.length).toBe(cfg.pages.length);

    // Force a raw crash
    await callE2E(context, 'crashRaw');

    // Wait for worker to come back online
    await waitForWorkerApi(context, 20000);

    // Allow a moment for initialization logic to run
    await new Promise(r => setTimeout(r, 1500));

    // Verify rotation is running and tabs are preserved
    const afterState: any = await callE2E(context, 'getState');
    const isRotating = !!afterState?.rotationState?.isRotating || !!afterState?.isRotating;
    expect(isRotating).toBeTruthy();

    const afterTabsCfg: any = await callE2E(context, 'getTabsConfig');
    const afterUrls = (afterTabsCfg.tabs || []).map((t: any) => t.url).filter(Boolean);

    // All initial URLs should still be present in the new state, in the same order.
    const initialUrls = cfg.pages.map((p: any) => p.url);
    expect(afterUrls.length).toBe(initialUrls.length);
    expect(afterUrls).toEqual(initialUrls);

    await context.close();
  });
});
