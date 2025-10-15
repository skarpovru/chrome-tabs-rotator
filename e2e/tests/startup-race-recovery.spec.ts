import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E as callApi } from '../utils/call-e2e-api';
import { waitForWorkerApi } from '../utils/reliability-helpers';

// Simulating a delayed restore: we monkey-patch storage.get inside the worker to introduce an artificial delay
// before initialize() completes. We want to ensure rotating state does not get lost.

const cfg = {
  pages: [
    { url: 'https://example.com/race1', delaySeconds: 2, reloadIntervalSeconds: 0 },
    { url: 'https://example.com/race2', delaySeconds: 2, reloadIntervalSeconds: 0 }
  ],
  isFullscreen: false,
  preventWindowFocus: false
};

test.describe('Startup recovery race', () => {
  test('does not lose isRotating amidst delayed restore', async ({ ext }) => {
  const { context, serviceWorker } = ext;
  const worker = await waitForWorkerApi(context);

    // Inject delay into storage.get path used by StartupRecovery.restore (best-effort: wrap original)
    await worker.evaluate(() => {
      const rs: any = (self as any).rotationService;
      const originalGet = rs.storage.get.bind(rs.storage);
      let injected = false;
      rs.storage.get = async (...args: any[]) => {
        // Only delay first few calls to mimic slow I/O
        if (!injected) {
          injected = true;
          await new Promise(r => setTimeout(r, 1200));
        }
        return originalGet(...args);
      };
    });

    await callApi(context, 'startWithConfig', cfg);
    // Immediately force another initialize (simulate UI start) while restore still finishing
    await worker.evaluate(async () => { try { await (self as any).rotationService.initialize({ preserveExisting: true }); } catch {} });

    await callApi(context, 'rotateOnce');
    const diags = await callApi(context, 'getDiagnostics');
    expect(diags.isRotating).toBeTruthy();
    // Ensure tabsConfig exists and pages length matches
    expect(diags.rotationState?.tabsConfig?.tabs?.length || diags.rotationState?.tabIds?.length).toBeGreaterThanOrEqual(2);
  });
});
