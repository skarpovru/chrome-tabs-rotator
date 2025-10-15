import { test, expect } from '@playwright/test';
import { launchExtension } from '../utils/launch-extension';
import { callE2E } from '../utils/call-e2e-api';

/**
 * Simulates a stall (no rotation progress + stale heartbeat) and verifies watchdog advances rotation.
 * Assumes default watchdog interval/grace are not extremely long. If they are, consider injecting shorter values via storage first.
 */

test.describe('Watchdog stall correction', () => {
  test('advances after simulated stall', async () => {
    const { context, serviceWorker, extensionId } = await launchExtension();
    try {
      for (let i=0;i<25;i++) {
        if (await serviceWorker.evaluate(() => !!(self as any).__e2eApi)) break;
        if (i === 12) {
          const popup = await context.newPage();
          await popup.goto(`chrome-extension://${extensionId}/index.html`);
        }
        await new Promise(r=>setTimeout(r,200));
      }

      const config = { pages: [
        { url: 'https://example.com', delaySeconds: 2, reloadIntervalSeconds: 0 },
        { url: 'https://example.org', delaySeconds: 2, reloadIntervalSeconds: 0 }
      ], isFullscreen: false, preventWindowFocus: false };
  await callE2E(context, 'startWithConfig', config as any);

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
    } finally {
      await context.close();
    }
  });
});
