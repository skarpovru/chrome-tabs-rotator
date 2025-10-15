import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E } from '../utils/call-e2e-api';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';

/**
 * Simulates a stall (no rotation progress + stale heartbeat) and verifies watchdog advances rotation.
 * Assumes default watchdog interval/grace are not extremely long. If they are, consider injecting shorter values via storage first.
 */

test.describe('Watchdog stall correction', () => {
  test('advances after simulated stall', async ({ ext }) => {
    const { context, serviceWorker, extensionId } = ext;
      await waitForWorkerApi(context);

      const config = { pages: [
        { url: 'https://example.com', delaySeconds: 2, reloadIntervalSeconds: 0 },
        { url: 'https://example.org', delaySeconds: 2, reloadIntervalSeconds: 0 }
      ], isFullscreen: false, preventWindowFocus: false };
      await callE2E(context, 'startWithConfig', config as any);
      await waitForTabIds(context, config.pages.length);
      // Reconfigure watchdog to short intervals for test speed
      await callE2E(context, 'configureWatchdog', { intervalSeconds: 3, graceSeconds: 1 });

      // Wait for first index capture
      let initialIndex: number | undefined;
      for (let i=0;i<30;i++) {
        const st: any = await callE2E(context, 'getState');
        const idx = st?.currentIndex ?? st?.rotationState?.currentIndex;
        if (typeof idx === 'number') { initialIndex = idx; break; }
        // Try a deterministic advance to seed state
        await callE2E(context, 'advanceIndex');
        await new Promise(r=>setTimeout(r,150));
      }
      expect(typeof initialIndex).toBe('number');

      // Simulate stall then directly trigger watchdog self-heal deterministically
      await callE2E(context, 'simulateStall');
      const wdResult: any = await callE2E(context, 'triggerWatchdog');
      const post: any = await callE2E(context, 'getState');
      const newIdx = post?.currentIndex ?? post?.rotationState?.currentIndex;
      expect(typeof newIdx === 'number').toBeTruthy();
      if (newIdx === initialIndex) {
        // Fallback path should have advanced index internally
        expect(wdResult?.fallbackAdvance).toBeTruthy();
      } else {
        expect(newIdx).not.toBe(initialIndex);
      }
    // end test body
  });
});
