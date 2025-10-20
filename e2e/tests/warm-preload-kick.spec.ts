import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E as callApi } from '../utils/call-e2e-api';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';

/**
 * Asserts that warmPreloadKicks counter increments after at least one rotation cycle
 * and a persistent missing page presence triggers the presence kick.
 */
 test.describe('Warm preload presence kick', () => {
  test('increments warmPreloadKicks after cycle >=1 and missing page', async ({ ext }) => {
    const { context } = ext;
    await waitForWorkerApi(context);
    const cfg = { pages: [
      { url: 'https://example.com/a', delaySeconds: 2, reloadIntervalSeconds: 0 },
      { url: 'https://example.com/b', delaySeconds: 2, reloadIntervalSeconds: 0 },
      { url: 'https://example.com/c', delaySeconds: 2, reloadIntervalSeconds: 0 }
    ], isFullscreen: false, preventWindowFocus: false } as any;
    await callApi(context, 'startWithConfig', cfg);
    await waitForTabIds(context, cfg.pages.length);

    // Drive rotations until rotationCycle >= 1 (wraps currentIndex)
    let state: any; let guard = 0;
    while (guard < cfg.pages.length * 3) {
      await callApi(context, 'rotateOnce');
      state = await callApi(context, 'getState');
      const rotationCycle = state?.rotationState?.rotationCycle || state?.rotationCycle || 0;
      if (rotationCycle >= 1) break;
      guard++;
    }

    // Snapshot initial kicks (should be 0 or small)
    const beforeCfg: any = await callApi(context, 'getTabsConfig');
    const beforeKicks = beforeCfg.warmPreloadKicks || 0;

    // Create two simultaneously missing pages (materialize-missing repairs at most one, leaving another for presence kick)
    const stBefore: any = await callApi(context, 'getState');
    const ci = stBefore?.rotationState?.currentIndex ?? stBefore?.currentIndex ?? 0;
    const pageIndices = [0,1,2].filter(i => i !== ci);
    // Force both non-current pages missing
    for (const idx of pageIndices) await callApi(context, 'makePageMissing', idx);

    // Perform a single rotate to trigger materialize-missing + presence kick sequence
    await callApi(context, 'rotateOnce');

    let observed = false; let last = beforeKicks; let tabsCfg: any;
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      tabsCfg = await callApi(context, 'getTabsConfig');
      const kicks = tabsCfg.warmPreloadKicks || 0;
      if (kicks > beforeKicks) { observed = true; last = kicks; break; }
      await new Promise(r => setTimeout(r, 150));
    }
    if (!observed) {
      const diags: any = await callApi(context, 'getDiagnostics');
      console.error('[e2e][warm-preload-kick] Did not observe warmPreloadKicks increment', { beforeKicks, last, diagnostics: diags, tabsCfg });
    }
    expect(observed).toBeTruthy();
  });
});
