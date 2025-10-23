import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E as callApi } from '../utils/call-e2e-api';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';
import { STABLE_DOMAIN_PRIMARY } from '../utils/stable-domains';

/**
 * Ensures rotation continues (no infinite activation retry) after a user manually closes
 * a tab that is currently scheduled (primary) before its activation.
 */
test.describe('Manual close recovery', () => {
  test('rotation advances after closing a scheduled tab', async ({ ext }) => {
    const { context } = ext;
    await waitForWorkerApi(context);
    const cfg = { pages: [
      { url: STABLE_DOMAIN_PRIMARY + '/1', delaySeconds: 2, reloadIntervalSeconds: 0 },
      { url: STABLE_DOMAIN_PRIMARY + '/2', delaySeconds: 2, reloadIntervalSeconds: 0 },
      { url: STABLE_DOMAIN_PRIMARY + '/3', delaySeconds: 2, reloadIntervalSeconds: 0 }
    ], isFullscreen: false, preventWindowFocus: false } as any;
    await callApi(context, 'startWithConfig', cfg);
  await waitForTabIds(context, cfg.pages.length, 8000, { injectSyntheticSuccess: true });

    // Drive rotation to index 1
    await callApi(context, 'rotateOnce');
    await callApi(context, 'rotateOnce');
    const before: any = await callApi(context, 'getState');
    const beforeIdx = before?.currentIndex ?? before?.rotationState?.currentIndex;

    // Close the *next* tab to be activated (simulate user closure)
    const tabsCfg: any = await callApi(context, 'getTabsConfig');
    const nextIndex = (beforeIdx + 1) % cfg.pages.length;
    const victim = tabsCfg.tabs[nextIndex].tabId;
    await callApi(context, 'closeTab', victim);

    // Force a rotation attempt – it should repair / recreate and move on
    let progressed = false;
    for (let i=0;i<6;i++) {
      await callApi(context, 'rotateOnce');
      const st: any = await callApi(context, 'getState');
      const idx = st?.currentIndex ?? st?.rotationState?.currentIndex;
      if (idx !== beforeIdx) { progressed = true; break; }
    }
    expect(progressed).toBeTruthy();
  });
});
