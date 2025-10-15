import { test, expect } from '@playwright/test';
import { launchExtension, simulateServiceWorkerRestart } from '../utils/launch-extension';
import { callE2E } from '../utils/call-e2e-api';

test.describe('Crash recovery (non-preserve scenario)', () => {
  test('recreates tabs when auto-preserve disabled', async () => {
    const { context, serviceWorker, extensionId } = await launchExtension();
    // Ensure SW ready
    for (let i=0;i<15;i++) { try { const d = await callE2E(context, 'getDiagnostics'); if (d) break; } catch {}; await new Promise(r=>setTimeout(r,200)); }
    // Start with config
    const config = { pages: [
      { url: 'https://example.com', delaySeconds: 3, reloadIntervalSeconds: 0 },
      { url: 'https://example.org', delaySeconds: 3, reloadIntervalSeconds: 0 }
    ], isFullscreen: false, preventWindowFocus: false };
  await callE2E(context, 'startWithConfig', config as any);
    // Capture original IDs
    let originalIds: number[] = [];
    for (let i=0;i<30;i++) {
  const diag = await callE2E(context, 'getDiagnostics');
      const ids = diag?.rotationState?.tabIds;
      if (Array.isArray(ids) && ids.length >= 2) { originalIds = ids.slice(); break; }
      await new Promise(r=>setTimeout(r,300));
    }
    expect(originalIds.length).toBeGreaterThanOrEqual(2);
    // Disable preserve and crash
  await callE2E(context, 'disableAutoPreserve');
  const newSw = await simulateServiceWorkerRestart(context);
  for (let i=0;i<30;i++) { try { const d = await callE2E(context, 'getDiagnostics'); if (d) break; } catch {}; await new Promise(r=>setTimeout(r,200)); }
    // Wait for rotation to restart (it should recreate tabs) - allow reinit
    let newIds: number[] = [];
    for (let i=0;i<40;i++) {
  const diag = await callE2E(context, 'getDiagnostics');
      const ids = diag?.rotationState?.tabIds;
      if (Array.isArray(ids) && ids.length >= 2) { newIds = ids.slice(); break; }
      await new Promise(r=>setTimeout(r,300));
    }
    expect(newIds.length).toBeGreaterThanOrEqual(2);
    // Ensure at least one ID differs (recreated)
    const overlap = newIds.filter(id => originalIds.includes(id));
    expect(overlap.length).toBeLessThan(originalIds.length);
    await context.close();
  });
});
