import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { simulateServiceWorkerRestart } from '../utils/launch-extension';
import { callE2E } from '../utils/call-e2e-api';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';

test.describe('Crash recovery (preserved resume)', () => {
  test('keeps tabs and resumes rotation after service worker restart', async ({ ext }) => {
    const { context, serviceWorker, extensionId } = ext;
  // Ensure at least one normal window/page exists (some environments may start with none).
  const page = await context.newPage();
  await page.goto('about:blank');
    await waitForWorkerApi(context);
  {
      // Enable test mode & seed config
      const config = { pages: [
        { url: 'https://example.com', delaySeconds: 3, reloadIntervalSeconds: 0 },
        { url: 'https://example.org', delaySeconds: 3, reloadIntervalSeconds: 0 }
      ], isFullscreen: false, preventWindowFocus: false };
  await callE2E(context, 'startWithConfig', config as any);
  const tabIds = await waitForTabIds(context, 2);

      // Force heartbeat just before crash to guarantee preservation heuristic sees a recent heartbeat
  await callE2E(context, 'forceHeartbeat');
  // Adopt tabs to ensure ownership is persisted
  await callE2E(context, 'adoptTabs');
  // Capture pre-crash snapshot
  const preCrash = await callE2E(context, 'getDiagnostics');

      // Restart SW (simulate crash)
  const newSw = await simulateServiceWorkerRestart(context);
      // Wait for __e2eApi in restarted worker
      await waitForWorkerApi(context); // ensure restarted worker ready
        // Verify preserved tabs still exist
        const preserved: any = await callE2E(context, 'listTabs');
        const existingIds = Array.isArray(preserved) ? new Set(preserved.map((t: any)=>t.id)) : new Set<number>();
        const missing = tabIds.filter(id => !existingIds.has(id));
        const preservedResult = { missing, all: Array.isArray(preserved) ? preserved : [] } as any;
        const postDiag = await callE2E(context, 'getDiagnostics');
  if (preservedResult?.missing?.length) {
          // Build a URL-based mapping to see if URLs are present but IDs changed
          const preTabs = preCrash.openTabs || [];
          const postTabs = postDiag.openTabs || [];
          const urlMap: Record<string, { preIds: number[]; postIds: number[] }> = {};
          for (const t of preTabs) {
            if (!t.url) continue; if (!urlMap[t.url]) urlMap[t.url] = { preIds: [], postIds: [] }; urlMap[t.url].preIds.push(t.id);
          }
          for (const t of postTabs) {
            if (!t.url) continue; if (!urlMap[t.url]) urlMap[t.url] = { preIds: [], postIds: [] }; urlMap[t.url].postIds.push(t.id);
          }
          console.log('After reload diagnostics (unexpected preservation failure)', {
            preserved: preservedResult,
            resumeReason: postDiag.resumeReason,
            expectedTabIds: tabIds,
            preCrashTabs: preTabs,
            postTabs,
            urlMap
          });
        }
  expect(preservedResult?.missing?.length).toBe(0);

      // Observe a rotation (active tab changes). Poll state index.
  const firstState: any = await callE2E(context, 'getState');
      const initialIndex = firstState?.currentIndex ?? firstState?.rotationState?.currentIndex ?? 0;
      let rotated = false;
      for (let i=0;i<12;i++) {
        await callE2E(context, 'rotateOnce');
        const st: any = await callE2E(context, 'getState');
        const idx = st?.currentIndex ?? st?.rotationState?.currentIndex;
        if (typeof idx === 'number' && idx !== initialIndex) { rotated = true; break; }
      }
      expect(rotated).toBeTruthy();
  }
  });
});
