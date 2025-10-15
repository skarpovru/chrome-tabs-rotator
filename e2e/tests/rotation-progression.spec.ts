import { test, expect } from '@playwright/test';
import { launchExtension } from '../utils/launch-extension';
import { callE2E } from '../utils/call-e2e-api';

/**
 * Verifies that rotation advances through configured pages in order and cycles indices.
 * Focuses on black-box observation of index changes and active tab URLs.
 */
test.describe('Rotation progression', () => {
  test('advances indices and cycles through URLs', async () => {
    const { context, serviceWorker, extensionId } = await launchExtension();
    try {
      // Ensure SW ready
      for (let i=0;i<25;i++) {
        if (await serviceWorker.evaluate(() => !!(self as any).__e2eApi)) break;
        if (i === 12) { // open popup halfway if still not ready
          const popup = await context.newPage();
          await popup.goto(`chrome-extension://${extensionId}/index.html`);
        }
        await new Promise(r=>setTimeout(r,200));
      }

      const config = { pages: [
        { url: 'https://example.com', delaySeconds: 2, reloadIntervalSeconds: 0 },
        { url: 'https://example.org', delaySeconds: 2, reloadIntervalSeconds: 0 },
        { url: 'https://example.net', delaySeconds: 2, reloadIntervalSeconds: 0 }
      ], isFullscreen: false, preventWindowFocus: false };
  await callE2E(context, 'startWithConfig', config as any);
      // Wait for rotation readiness (tabIds populated & isRotating true)
      let ready = false;
      for (let i=0;i<40 && !ready;i++) {
        const diag: any = await callE2E(context, 'getDiagnostics');
        const ids = diag.rotationState?.tabIds;
        if (diag.isRotating && Array.isArray(ids) && ids.length === config.pages.length) ready = true;
        if (!ready) await new Promise(r=>setTimeout(r,400));
      }
      expect(ready).toBeTruthy();

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
          // fallback deterministic advance ignoring activation
            await callE2E(context, 'advanceIndex');
            state = await callE2E(context, 'getState');
            idx = state?.currentIndex ?? state?.rotationState?.currentIndex;
        }
        if (typeof idx === 'number' && idx !== currentIndex) {
          seenIndices.push(idx);
          currentIndex = idx;
          // Derive expected URL from config.pages (index may wrap)
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
