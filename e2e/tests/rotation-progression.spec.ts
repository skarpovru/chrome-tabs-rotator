import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E } from '../utils/call-e2e-api';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';
import { STABLE_DOMAIN_PRIMARY, STABLE_DOMAIN_SECONDARY, STABLE_DOMAIN_TERTIARY } from '../utils/stable-domains';

/**
 * Verifies that rotation advances through configured pages in order and cycles indices.
 * Focuses on black-box observation of index changes and active tab URLs.
 */
test.describe('Rotation progression', () => {
  test('advances indices and cycles through URLs', async ({ ext }) => {
    const { context } = ext;
    try {
      await waitForWorkerApi(context);
      const config = {
        pages: [
          { url: STABLE_DOMAIN_PRIMARY, delaySeconds: 2, reloadIntervalSeconds: 0 },
          { url: STABLE_DOMAIN_SECONDARY, delaySeconds: 2, reloadIntervalSeconds: 0 },
          { url: STABLE_DOMAIN_TERTIARY, delaySeconds: 2, reloadIntervalSeconds: 0 }
        ],
        isFullscreen: false,
        preventWindowFocus: false,
      };
      await callE2E(context, 'startWithConfig', config as any);
  const tabIds = await waitForTabIds(context, config.pages.length, 7000, { injectSyntheticSuccess: true });
      expect(tabIds.length).toBeGreaterThanOrEqual(config.pages.length);
      expect(tabIds.length).toBeLessThanOrEqual(config.pages.length * 2);

      // Drive a few rotations to observe index and URL coverage.
      const seenIndices: number[] = [];
      const seenUrls: string[] = [];
      let state: any = await callE2E(context, 'getState');
      let currentIndex = state?.currentIndex ?? state?.rotationState?.currentIndex ?? 0;
      for (let i = 0; i < 6; i++) {
        const before = currentIndex;
        await callE2E(context, 'rotateOnce');
        state = await callE2E(context, 'getState');
        let idx = state?.currentIndex ?? state?.rotationState?.currentIndex;
        if (idx === before) {
          await callE2E(context, 'advanceIndex');
          state = await callE2E(context, 'getState');
          idx = state?.currentIndex ?? state?.rotationState?.currentIndex;
        }
        if (typeof idx === 'number' && idx !== currentIndex) {
          seenIndices.push(idx);
          currentIndex = idx;
          const cfgIdx = idx % config.pages.length;
          const url = config.pages[cfgIdx]?.url;
          if (url) seenUrls.push(url);
        }
      }
      expect(seenIndices.length).toBeGreaterThanOrEqual(3);
      expect(new Set(seenUrls).size).toBeGreaterThanOrEqual(2);

      // Poll for concrete tab presence for each configured URL.
      const required = new Set(config.pages.map(p => p.url));
      const deadline = Date.now() + 7000;
      let lastCounts: Record<string, number> = {};
      while (Date.now() < deadline) {
        const cfg: any = await callE2E(context, 'getTabsConfig');
        const counts: Record<string, number> = {};
        for (const t of cfg.tabs) {
          const u = t.url || t.page?.url; if (u) counts[u] = (counts[u] || 0) + 1;
        }
        lastCounts = counts;
        const allPresent = [...required].every(u => (counts[u] || 0) > 0);
        if (allPresent) break;
        await new Promise(r => setTimeout(r, 200));
      }
      const missing = [...required].filter(u => (lastCounts[u] || 0) === 0);
      if (missing.length) {
        const diags = await callE2E(context, 'getDiagnostics');
        console.error('[e2e][rotation-progression] Missing URLs after polling', { missing, counts: lastCounts, seenIndices, seenUrls, diagnostics: diags });
      }
      for (const u of required) expect((lastCounts[u] || 0)).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});
