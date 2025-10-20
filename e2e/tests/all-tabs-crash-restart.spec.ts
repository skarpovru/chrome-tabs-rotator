import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E as callApi } from '../utils/call-e2e-api';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';
import { simulateServiceWorkerRestart } from '../utils/launch-extension';

/**
 * Simulates catastrophic loss of all rotation tabs (user or crash closed them) followed by
 * a service worker restart. Verifies that tabs are re-materialized (materialize-missing +
 * presence kick warm preloads) and rotation resumes with all pages represented (primary or preload).
 */
 test.describe('All tabs crash + restart recovery', () => {
  test('recreates all pages and resumes rotation', async ({ ext }) => {
    const { context } = ext;
    await waitForWorkerApi(context);
    const cfg = { pages: [
      { url: 'https://example.com/r1', delaySeconds: 2, reloadIntervalSeconds: 0 },
      { url: 'https://example.com/r2', delaySeconds: 2, reloadIntervalSeconds: 0 },
      { url: 'https://example.com/r3', delaySeconds: 2, reloadIntervalSeconds: 0 },
      { url: 'https://example.com/r4', delaySeconds: 2, reloadIntervalSeconds: 0 }
    ], isFullscreen: false, preventWindowFocus: false } as any;
    await callApi(context, 'startWithConfig', cfg);
    await waitForTabIds(context, cfg.pages.length);

    // Drive a couple rotations so that some preloads may exist
    for (let i=0;i<cfg.pages.length + 1;i++) await callApi(context, 'rotateOnce');

    // Snapshot current tabs then close them all to simulate crash loss
    const beforeTabs: any = await callApi(context, 'getTabsConfig');
    for (const t of beforeTabs.tabs) {
      if (t.tabId) await callApi(context, 'closeTab', t.tabId);
      if (t.nextTabId && t.nextTabId !== t.tabId) await callApi(context, 'closeTab', t.nextTabId);
    }

    // Confirm all configured URLs currently absent
    const openAfterClose: any = await callApi(context, 'getDiagnostics');
  const urlsRemaining = (openAfterClose.openTabs || []).filter((t: any) => t.url && cfg.pages.some((p: any) => p.url === t.url));
    // It's acceptable if some recreate instantly; just log if any remained.
    if (urlsRemaining.length) console.log('[all-tabs-crash-restart] Some URLs remained immediately after closure', urlsRemaining);

    // Restart service worker (extension restart simulation)
    await simulateServiceWorkerRestart(context);
    await waitForWorkerApi(context);

    // Poll for full re-materialization: each page has a tabId or nextTabId.
    const deadline = Date.now() + 15000; // allow time for serialized materialize-missing passes + presence kick
    let recovered = false; let lastCfg: any; let lastKicks = 0;
    while (Date.now() < deadline) {
      await callApi(context, 'rotateOnce'); // drive repair loop
      lastCfg = await callApi(context, 'getTabsConfig');
      lastKicks = lastCfg.warmPreloadKicks || 0;
      const represented = lastCfg.tabs.filter((t: any)=> (t.tabId > 0) || (t.nextTabId > 0));
      if (represented.length >= cfg.pages.length) { recovered = true; break; }
      await new Promise(r => setTimeout(r, 300));
    }

    if (!recovered) {
      const diags: any = await callApi(context, 'getDiagnostics');
      console.error('[all-tabs-crash-restart] Recovery incomplete', { tabs: lastCfg, kicks: lastKicks, diagnostics: diags });
    }

    expect(recovered).toBeTruthy();

    // Assert rotation active and index advances
    const state1: any = await callApi(context, 'getState');
    const baseIndex = state1?.rotationState?.currentIndex ?? state1?.currentIndex ?? 0;
    let advanced = false;
    for (let i=0;i<cfg.pages.length * 2;i++) {
      await callApi(context, 'rotateOnce');
      const st: any = await callApi(context, 'getState');
      const idx = st?.rotationState?.currentIndex ?? st?.currentIndex;
      if (idx !== baseIndex) { advanced = true; break; }
    }
    expect(advanced).toBeTruthy();
  });
});
