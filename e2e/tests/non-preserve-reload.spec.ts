import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { simulateServiceWorkerRestart } from '../utils/launch-extension';
import { callE2E } from '../utils/call-e2e-api';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';
import { STABLE_DOMAIN_PRIMARY, STABLE_DOMAIN_SECONDARY } from '../utils/stable-domains';

test.describe('Crash recovery (non-preserve scenario)', () => {
  test('recreates tabs when auto-preserve disabled', async ({ ext }) => {
  const { context } = ext;
  await waitForWorkerApi(context);
    // Start with config
    const config = { pages: [
      { url: STABLE_DOMAIN_PRIMARY, delaySeconds: 3, reloadIntervalSeconds: 0 },
      { url: STABLE_DOMAIN_SECONDARY, delaySeconds: 3, reloadIntervalSeconds: 0 }
    ], isFullscreen: false, preventWindowFocus: false };
    await callE2E(context, 'startWithConfig', config as any);
  const originalIds = await waitForTabIds(context, 2, 8000, { injectSyntheticSuccess: true });
    // Disable preserve and crash
  await callE2E(context, 'disableAutoPreserve');
    await simulateServiceWorkerRestart(context);
    await waitForWorkerApi(context);
    // Wait for rotation to restart (it should recreate tabs) - allow reinit
  const newIds = await waitForTabIds(context, 2, 8000, { injectSyntheticSuccess: true });
    // Ensure at least one ID differs (recreated)
    const overlap = newIds.filter(id => originalIds.includes(id));
    expect(overlap.length).toBeLessThan(originalIds.length);
    await context.close();
  });
});
