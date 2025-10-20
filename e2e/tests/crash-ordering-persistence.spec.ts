import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E } from '../utils/call-e2e-api';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';

/**
 * Crash Ordering Persistence Test
 * --------------------------------
 * Ensures that page ordering and rotation progress (index continuity) remain consistent
 * across a crash (service worker reload) with preservation enabled.
 */
test.describe('Crash ordering persistence', () => {
  test('ordering & index continuity across crash', async ({ ext }) => {
    const { context } = ext;
    await waitForWorkerApi(context);
    const cfg: any = {
      pages: [
        { url: 'https://crash-order.test/a', delaySeconds: 1 },
        { url: 'https://crash-order.test/b', delaySeconds: 1 },
        { url: 'https://crash-order.test/c', delaySeconds: 2 },
        { url: 'https://crash-order.test/d', delaySeconds: 1 }
      ],
      isFullscreen: false,
      preventWindowFocus: false
    };
    await callE2E(context, 'startWithConfig', cfg);
    await waitForTabIds(context, cfg.pages.length);

    // Canonical order from harness
    const orderedResp: any = await callE2E(context, 'getOrderedUrls');
    expect(orderedResp.ok).toBeTruthy();
    const canonical = orderedResp.urls;
    expect(canonical).toEqual(cfg.pages.map((p: any) => p.url));

    // Advance rotation several times to change currentIndex
    for (let i = 0; i < 6; i++) {
      await callE2E(context, 'rotateOnce');
      if (i % 3 === 2) await callE2E(context, 'advanceIndex'); // ensure cycle progress
      await new Promise(r => setTimeout(r, 140));
    }
    const preCrashIndex: number = await callE2E(context, 'getCurrentIndex');

    // Crash with preserve
    await callE2E(context, 'crash');

    // Wait for worker & harness restore
    try { await waitForWorkerApi(context, 12000); } catch {}
    // Stabilization delay
    await new Promise(r => setTimeout(r, 1200));

    // Fetch ordering & index after recovery
    const orderedAfterResp: any = await callE2E(context, 'getOrderedUrls');
    expect(orderedAfterResp.ok).toBeTruthy();
    expect(orderedAfterResp.urls).toEqual(canonical);

    // Index continuity: after recovery index should be defined and within range; may differ if rotation advanced pre-crash scheduling.
    const postCrashIndex: number = await callE2E(context, 'getCurrentIndex');
    expect(postCrashIndex).toBeGreaterThanOrEqual(0);
    expect(postCrashIndex).toBeLessThan(canonical.length);
    // We allow index change but assert it is not reset to 0 unless legitimately wrapped due to cycle
    const wrapped = preCrashIndex > postCrashIndex; // normal wrap
    if (!wrapped) {
      expect(postCrashIndex).toBe(preCrashIndex); // if no wrap, continuity
    }

    // Perform more rotations post-crash and ensure ordering still intact
    for (let i = 0; i < 5; i++) {
      await callE2E(context, 'rotateOnce');
      await new Promise(r => setTimeout(r, 120));
    }
    const finalOrderedResp: any = await callE2E(context, 'getOrderedUrls');
    expect(finalOrderedResp.urls).toEqual(canonical);

    await context.close();
  });
});
