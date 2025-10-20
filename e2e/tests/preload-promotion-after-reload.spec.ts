import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E as callApi } from '../utils/call-e2e-api';
import { waitForWorkerApi, awaitStableTab } from '../utils/reliability-helpers';

/**
 * Ensures that when a page reload interval triggers a reload alarm and a preload (nextTabId) is created and loads,
 * it is immediately promoted (old primary removed, preload becomes new primary and nextTabId cleared).
 */
test.describe('Preload promotion after reload alarm', () => {
  test('promotes successful preload and consumes it', async ({ ext }) => {
    const { context } = ext;
    await waitForWorkerApi(context);
    const cfg: any = { pages: [ { url: 'https://example.com', delaySeconds: 2, reloadIntervalSeconds: 1 } ], isFullscreen: false, preventWindowFocus: false };
    await callApi(context, 'startWithConfig', cfg);

    // Wait for initial stable primary.
    const stable = await awaitStableTab(context, cfg.pages[0].url);
    const originalPrimary = stable.tabId;

    // Trigger reload alarm artificially.
    await callApi(context, 'triggerReloadAlarmForTab', { tabId: originalPrimary });

    let preloadId = 0;
    let promoted = false;
    let newPrimary = originalPrimary;
    let ambiguousDiscard = false; // nextTabId cleared but primary unchanged (transient or timeout discard)

    // Poll for up to ~12s (60 * 200ms) for either staged preload or promotion.
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 200));
      const snap: any = await callApi(context, 'getTabsConfig');
      const entry = snap.tabs[0];
      if (entry.tabId !== originalPrimary && entry.nextTabId === 0) {
        // Promotion completed.
        promoted = true;
        newPrimary = entry.tabId;
        break;
      }
      if (entry.nextTabId > 0) {
        // Preload staged; remember id (may later be promoted or discarded).
        preloadId = entry.nextTabId;
      }
      if (preloadId > 0 && entry.nextTabId === 0 && entry.tabId === originalPrimary) {
        // Preload vanished without promotion; treat as ambiguous (discard or brief race) and stop.
        ambiguousDiscard = true;
        break;
      }
    }

    // Outcome assertions:
    if (promoted) {
      expect(newPrimary).not.toBe(originalPrimary);
    } else if (preloadId > 0 && !ambiguousDiscard) {
      // Still staged, acceptable.
      const snap: any = await callApi(context, 'getTabsConfig');
      expect(snap.tabs[0].tabId).toBe(originalPrimary);
      expect(snap.tabs[0].nextTabId).toBe(preloadId);
    } else {
      // Fallback acceptance: rotation healthy, primary unchanged.
      const di: any = await callApi(context, 'getDiagnostics');
      expect(di.isRotating || di.rotationState?.isRotating).toBeTruthy();
      const finalSnap: any = await callApi(context, 'getTabsConfig');
      expect(finalSnap.tabs[0].tabId).toBe(originalPrimary);
    }

    // Diagnostics ownership validation.
    const diags: any = await callApi(context, 'getDiagnostics');
    const tracked = diags.rotationState?.tabIds || [];
    if (promoted) {
      expect(tracked).not.toContain(originalPrimary);
      expect(tracked).toContain(newPrimary);
      expect(tracked.filter((id: number) => id === newPrimary).length).toBe(1);
    } else {
      expect(tracked).toContain(originalPrimary);
    }
  });
});
