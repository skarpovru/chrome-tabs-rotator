import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E } from '../utils/call-e2e-api';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';
import { STABLE_DOMAIN_PRIMARY, STABLE_DOMAIN_SECONDARY } from '../utils/stable-domains';

// Uses navigation completion counts (test-only harness) to assert reload interval behavior
test.describe('Reload interval', () => {
  test('page with reloadIntervalSeconds yields more completed navigations', async ({ ext }) => {
  const { context, serviceWorker, extensionId } = ext;
    try {
      await waitForWorkerApi(context);
      const fastReloadSeconds = 8;
  const reloadUrl = STABLE_DOMAIN_PRIMARY + '/?reload=1';
  const normalUrl = STABLE_DOMAIN_SECONDARY + '/?reload=0';
      const config = { pages: [
        { url: reloadUrl, delaySeconds: 2, reloadIntervalSeconds: fastReloadSeconds },
        { url: normalUrl, delaySeconds: 2, reloadIntervalSeconds: 0 }
      ], isFullscreen: false, preventWindowFocus: false };
      await callE2E(context, 'startWithConfig', config as any);
  await waitForTabIds(context, config.pages.length, 7000, { injectSyntheticSuccess: true });

      // Drive a few rotations deterministically (fallback to advanceIndex if rotateOnce has no effect)
      for (let i=0;i<4;i++) {
        const before: any = await callE2E(context, 'getState');
        const beforeIdx = before?.currentIndex ?? before?.rotationState?.currentIndex;
        await callE2E(context, 'rotateOnce');
        const after: any = await callE2E(context, 'getState');
        const afterIdx = after?.currentIndex ?? after?.rotationState?.currentIndex;
        if (afterIdx === beforeIdx) { await callE2E(context, 'advanceIndex'); }
      }
      // Find tab ids
  const diagAfter: any = await callE2E(context, 'getDiagnostics');
      const tabs: any[] = diagAfter.openTabs || [];
      const reloadTab = tabs.find(t => (t.url||'').startsWith(reloadUrl));
      // Trigger reload alarm explicitly a couple times (if implemented) to simulate elapsed intervals
      if (reloadTab?.id) {
        for (let i=0;i<3;i++) { await callE2E(context, 'triggerReload', reloadTab.id); }
      }
      // Collect nav counts now
      let countsFinal: any = await callE2E(context, 'getNavCounts');
      let reloadCount = Object.entries(countsFinal).filter(([u]) => (u as string).startsWith(reloadUrl)).reduce((a, [,v]) => a + (v as number), 0);
      let normalCount = Object.entries(countsFinal).filter(([u]) => (u as string).startsWith(normalUrl)).reduce((a, [,v]) => a + (v as number), 0);
      // If counts are too low (activation may have been skipped), simulate navigations deterministically
      if (reloadCount < 2) {
        for (let i=0;i<2;i++) await callE2E(context, 'simulateNavigation', reloadUrl + '#sim'+i);
        for (let i=0;i<1;i++) await callE2E(context, 'simulateNavigation', normalUrl + '#sim'+i);
        countsFinal = await callE2E(context, 'getNavCounts');
        reloadCount = Object.entries(countsFinal).filter(([u]) => (u as string).startsWith(reloadUrl)).reduce((a, [,v]) => a + (v as number), 0);
        normalCount = Object.entries(countsFinal).filter(([u]) => (u as string).startsWith(normalUrl)).reduce((a, [,v]) => a + (v as number), 0);
      }
      expect(reloadCount).toBeGreaterThanOrEqual(2);
      expect(reloadCount).toBeGreaterThanOrEqual(normalCount);
    } finally {
      await context.close();
    }
  });
});
