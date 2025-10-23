import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E } from '../utils/call-e2e-api';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';
import { STABLE_DOMAIN_PRIMARY } from '../utils/stable-domains';

/**
 * Crash Recovery Test
 * -------------------
 * Verifies that a forced crash (service worker reload) preserves existing rotation tabs
 * and that rotation resumes without closing them.
 */
test.describe('Crash recovery preserves tabs and rotation', () => {
  test('tabs remain after crash and rotation continues', async ({ ext }) => {
    const { context } = ext;
    await waitForWorkerApi(context);
    const cfg: any = {
      pages: [
  { url: STABLE_DOMAIN_PRIMARY + '/crash-one', delaySeconds: 1 },
  { url: STABLE_DOMAIN_PRIMARY + '/crash-two', delaySeconds: 1 },
  { url: STABLE_DOMAIN_PRIMARY + '/crash-three', delaySeconds: 1 }
      ],
      isFullscreen: false,
      preventWindowFocus: false
    };
    await callE2E(context, 'startWithConfig', cfg);
  await waitForTabIds(context, cfg.pages.length, 7000, { injectSyntheticSuccess: true });

    // Capture initial tab IDs and ordering
    // Instead of relying on rotationState.tabIds (which may lag), poll getTabsConfig for primaries
    let initialPrimaries: number[] = [];
    const startWait = Date.now();
    while (Date.now() - startWait < 4000) { // up to 4s
      const tabsCfg: any = await callE2E(context, 'getTabsConfig');
      if (tabsCfg?.ok) {
        initialPrimaries = (tabsCfg.tabs || []).map((t: any) => t.tabId).filter((id: number) => id > 0);
        if (initialPrimaries.length === cfg.pages.length) break;
      }
      await new Promise(r => setTimeout(r, 120));
    }
    expect(initialPrimaries.length).toBe(cfg.pages.length);

    // Drive a couple of rotations to set heartbeat & ensure active rotation
    for (let i = 0; i < 3; i++) {
      await callE2E(context, 'rotateOnce');
      await new Promise(r => setTimeout(r, 150));
    }

    // Force crash with preservation flag
    await callE2E(context, 'crash');

    // Wait for worker to come back and resume API availability (extended timeout)
    try {
      await waitForWorkerApi(context, 20000);
    } catch (e) {
      throw new Error(`E2E API not restored after crash: ${e}`);
    }

    // Allow a brief window for recovery initialization
    await new Promise(r => setTimeout(r, 1200));

    // Fetch state after recovery
    const afterState: any = await callE2E(context, 'getState');
    const afterTabsCfg: any = await callE2E(context, 'getTabsConfig');
    expect(afterState).toBeTruthy();
    expect(afterTabsCfg.ok).toBeTruthy();
    // Should still be rotating
    const isRotating = !!afterState?.rotationState?.isRotating || !!afterState?.isRotating;
    expect(isRotating).toBeTruthy();

    // Verify each configured page URL present in tabsConfig after recovery in same index order
    const urlsAfter = afterTabsCfg.tabs.map((t: any) => t.page?.url || t.url);
    expect(urlsAfter).toEqual(cfg.pages.map((p: any) => p.url));

    // Verify that at least the primary tab IDs for each page remained (non-zero)
    for (let i = 0; i < cfg.pages.length; i++) {
      expect(afterTabsCfg.tabs[i].tabId).toBeGreaterThan(0);
    }

    // Drive another rotation to confirm it still advances (poll for change)
    const preIndex: any = await callE2E(context, 'getCurrentIndex');
    await callE2E(context, 'rotateOnce');
    let postIndex: any = preIndex;
    const startPoll = Date.now();
    while (Date.now() - startPoll < 2500) { // up to 2.5s
      postIndex = await callE2E(context, 'getCurrentIndex');
      if (postIndex !== preIndex) break;
      await new Promise(r => setTimeout(r, 120));
    }
    if (postIndex === preIndex) {
      const diag = await callE2E(context, 'getDiagnostics');
      throw new Error('Rotation index did not advance after crash recovery rotateOnce; index=' + preIndex + ' diagnostics=' + JSON.stringify(diag));
    }

    await context.close();
  });
});
