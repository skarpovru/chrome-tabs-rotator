import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { simulateServiceWorkerRestart } from '../utils/launch-extension';
import { callE2E } from '../utils/call-e2e-api';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';

test.describe('Crash recovery (non-preserve scenario)', () => {
  test('recreates tabs when auto-preserve disabled', async ({ ext }) => {
  const { context } = ext;
  await waitForWorkerApi(context);
    // Start with config
    const config = { pages: [
      { url: 'https://example.com', delaySeconds: 3, reloadIntervalSeconds: 0 },
      { url: 'https://example.org', delaySeconds: 3, reloadIntervalSeconds: 0 }
    ], isFullscreen: false, preventWindowFocus: false };
    await callE2E(context, 'startWithConfig', config as any);
    const originalIds = await waitForTabIds(context, 2);
    // Disable preserve and crash
  await callE2E(context, 'disableAutoPreserve');
    await simulateServiceWorkerRestart(context);
    await waitForWorkerApi(context);
    // Wait for rotation to restart (it should recreate tabs) - allow reinit
    const newIds = await waitForTabIds(context, 2);
    // Ensure at least one ID differs (recreated)
    const overlap = newIds.filter(id => originalIds.includes(id));
    expect(overlap.length).toBeLessThan(originalIds.length);
    await context.close();
  });
});
