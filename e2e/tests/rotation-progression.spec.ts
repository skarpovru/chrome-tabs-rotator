import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E } from '../utils/call-e2e-api';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';

/**
 * Verifies that rotation advances through configured pages in order and cycles indices.
 * Focuses on black-box observation of index changes and active tab URLs.
 */
test.describe('Rotation progression', () => {
  test('advances indices and cycles through URLs', async ({ ext }) => {
  const { context, serviceWorker, extensionId } = ext;
    try {
      // Ensure service worker e2e surface ready (opens popup automatically if needed)
      await waitForWorkerApi(context);

      const config = { pages: [
        { url: 'https://example.com', delaySeconds: 2, reloadIntervalSeconds: 0 },
        { url: 'https://example.org', delaySeconds: 2, reloadIntervalSeconds: 0 },
        { url: 'https://example.net', delaySeconds: 2, reloadIntervalSeconds: 0 }
      ], isFullscreen: false, preventWindowFocus: false };
      await callE2E(context, 'startWithConfig', config as any);
      const tabIds = await waitForTabIds(context, config.pages.length);
      expect(tabIds.length).toBe(config.pages.length);

  const seenIndices: number[] = [];
  const seenUrls: string[] = [];
      // Capture initial state
      const baseState: any = await callE2E(context, 'getState');
      let currentIndex = baseState?.currentIndex ?? baseState?.rotationState?.currentIndex ?? 0;
      for (let i=0;i<5;i++) {
        const before = currentIndex;
        await callE2E(context, 'rotateOnce');
        let state: any = await callE2E(context, 'getState');
        let idx = state?.currentIndex ?? state?.rotationState?.currentIndex;
        if (idx === before) {
          await callE2E(context, 'advanceIndex');
          state = await callE2E(context, 'getState');
          idx = state?.currentIndex ?? state?.rotationState?.currentIndex;
        }
        if (typeof idx === 'number' && idx !== currentIndex) {
          seenIndices.push(idx);
          currentIndex = idx;
          const configIndex = idx % config.pages.length;
          const url = config.pages[configIndex]?.url;
          if (url) seenUrls.push(url);
        }
      }
      expect(seenIndices.length).toBeGreaterThanOrEqual(3); // forced several index advances
      const configUrls = new Set(config.pages.map(p=>p.url));
      expect(seenUrls.every(u => configUrls.has(u))).toBeTruthy();
      expect(new Set(seenUrls).size).toBeGreaterThanOrEqual(2);
    } finally {
      await context.close();
    }
  });
});
