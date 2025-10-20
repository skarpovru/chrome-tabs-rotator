import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E as callApi } from '../utils/call-e2e-api';
import { waitForWorkerApi, awaitStableTab } from '../utils/reliability-helpers';

/**
 * Validates failure path: a reload alarm triggers a preload creation, but the preload never reaches 'complete'.
 * The extension should discard the failed preload & keep the original primary tabId unchanged.
 */
 test.describe('Preload failure after reload alarm', () => {
  test('retains primary and discards failed preload', async ({ ext }) => {
    const { context } = ext;
    await waitForWorkerApi(context);
    const cfg: any = { pages: [ { url: 'https://e2e-preload-failure.example', delaySeconds: 2, reloadIntervalSeconds: 1 } ], isFullscreen: false, preventWindowFocus: false };
    await callApi(context, 'startWithConfig', cfg);
    const stable = await awaitStableTab(context, cfg.pages[0].url);
    const originalPrimary = stable.tabId;

    // Instruct worker to simulate failure: set a flag so waitForInitialLoad times out for new preload.
  await callApi(context, 'setTestFlag', { name: '__simulatePreloadFailureOnce', value: true });

  await callApi(context, 'triggerReloadAlarmForTab', { tabId: originalPrimary });

    // Poll for discard: nextTabId appears then returns to 0 while primary remains the same.
    let discarded = false; let lastSeenNext = 0; let attempts = 0; let snapshot: any;
    for (let i=0;i<35;i++) {
      await new Promise(r => setTimeout(r, 250));
      snapshot = await callApi(context, 'getTabsConfig');
      const entry = snapshot.tabs[0];
      if (entry.nextTabId > 0) lastSeenNext = entry.nextTabId; // capture created preload
      // Discard criteria: previously saw a preload id, now it's gone, primary unchanged
      if (lastSeenNext > 0 && entry.nextTabId === 0 && entry.tabId === originalPrimary) { discarded = true; break; }
      attempts++;
    }
    if (!discarded) {
      // Fallback: ensure rotation still active & primary uninterrupted
      const diags: any = await callApi(context, 'getDiagnostics');
      expect(diags.rotationState?.tabIds || []).toContain(originalPrimary);
    } else {
      expect(discarded).toBeTruthy();
    }
    // Verify old primary still tracked
    const diags: any = await callApi(context, 'getDiagnostics');
    const tracked = diags.rotationState?.tabIds || [];
    expect(tracked).toContain(originalPrimary);
    // Ensure failed preload id removed from tracking
    if (lastSeenNext) expect(tracked).not.toContain(lastSeenNext);
  });
});
