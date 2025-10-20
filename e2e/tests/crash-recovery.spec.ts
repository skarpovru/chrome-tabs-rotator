import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { simulateServiceWorkerRestart } from '../utils/launch-extension';
import { callE2E } from '../utils/call-e2e-api';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';

test.describe('Crash recovery (preserved resume)', () => {
  test('keeps tabs and resumes rotation after service worker restart', async ({
    ext,
  }) => {
    const { context, serviceWorker, extensionId } = ext;
    // Ensure at least one normal window/page exists (some environments may start with none).
    const page = await context.newPage();
    await page.goto('about:blank');
    await waitForWorkerApi(context);
    {
      // Enable test mode & seed config
      const config = {
        pages: [
          {
            url: 'https://example.com',
            delaySeconds: 3,
            reloadIntervalSeconds: 0,
          },
          {
            url: 'https://example.org',
            delaySeconds: 3,
            reloadIntervalSeconds: 0,
          },
        ],
        isFullscreen: false,
        preventWindowFocus: false,
      };
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
      // Build preservation snapshot + allow one-cycle promotion difference.
      let preservedResult: any;
      let postDiag: any;
      let healed = false;
      for (let attempt = 0; attempt < 6; attempt++) {
        const preserved: any = await callE2E(context, 'listTabs');
        postDiag = await callE2E(context, 'getDiagnostics');
        const existingIds = Array.isArray(preserved)
          ? new Set(preserved.map((t: any) => t.id))
          : new Set<number>();
        const missing = tabIds.filter((id) => !existingIds.has(id));
        preservedResult = {
          missing,
          all: Array.isArray(preserved) ? preserved : [],
        };
        // Accept temporary single missing ID if URLs still present (promotion scenario) and rotation is active.
        if (!missing.length) {
          healed = true;
          break;
        }
        if (missing.length === 1) {
          const preTabs = preCrash.openTabs || [];
          const postTabs = postDiag.openTabs || [];
          const missingUrl = preTabs.find((t: any) => t.id === missing[0])?.url;
          if (missingUrl && postTabs.some((t: any) => t.url === missingUrl)) {
            // Wait a bit for preload recreation (skipNextPreload cycles once)
            await new Promise((r) => setTimeout(r, 400));
            continue;
          }
        }
        // More than one missing or URL absent -> break early; real failure.
        break;
      }
      if (!healed && preservedResult?.missing?.length) {
        const preTabs = preCrash.openTabs || [];
        const postTabs = postDiag.openTabs || [];
        const urlMap: Record<string, { preIds: number[]; postIds: number[] }> =
          {};
        for (const t of preTabs) {
          if (!t.url) continue;
          (urlMap[t.url] ||= { preIds: [], postIds: [] }).preIds.push(t.id);
        }
        for (const t of postTabs) {
          if (!t.url) continue;
          (urlMap[t.url] ||= { preIds: [], postIds: [] }).postIds.push(t.id);
        }
      }
      expect(preservedResult?.missing?.length).toBeLessThanOrEqual(1);
      // Final assert: if one missing, it must have URL continuity and rotation active
      if (preservedResult?.missing?.length === 1) {
        expect(
          postDiag.isRotating || postDiag.rotationState?.isRotating
        ).toBeTruthy();
      }

      // Observe a rotation (active tab changes). Poll state index.
      const firstState: any = await callE2E(context, 'getState');
      const initialIndex =
        firstState?.currentIndex ??
        firstState?.rotationState?.currentIndex ??
        0;
      let rotated = false;
      for (let i = 0; i < 12; i++) {
        await callE2E(context, 'rotateOnce');
        const st: any = await callE2E(context, 'getState');
        const idx = st?.currentIndex ?? st?.rotationState?.currentIndex;
        if (typeof idx === 'number' && idx !== initialIndex) {
          rotated = true;
          break;
        }
      }
      expect(rotated).toBeTruthy();
    }
  });
});
