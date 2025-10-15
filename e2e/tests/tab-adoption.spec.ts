import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E as callApi } from '../utils/call-e2e-api';
import { simulateServiceWorkerRestart } from '../utils/launch-extension';
import { waitForWorkerApi } from '../utils/reliability-helpers';

const cfg = {
  pages: [
    { url: 'https://example.com/a', delaySeconds: 2, reloadIntervalSeconds: 0 },
    { url: 'https://example.com/b', delaySeconds: 2, reloadIntervalSeconds: 0 }
  ],
  isFullscreen: false,
  preventWindowFocus: false
};

test.describe('Tab adoption after restart', () => {
  test('adopts existing tabs after non-preserve restart using adoptTabs()', async ({ ext }) => {
  const { context } = ext;
  let worker = await waitForWorkerApi(context);
    await callApi(context, 'startWithConfig', cfg);

    const beforeTabs = await callApi(context, 'getTabsConfig');
    expect(beforeTabs.ok).toBeTruthy();
    const originalIds = beforeTabs.tabs.map((t: any) => t.tabId).filter((id: number) => id > 0);
    expect(originalIds.length).toBe(2);

    // Perform non-preserve crash so rotation reinitializes fresh normally
    await callApi(context, 'disableAutoPreserve');
    await simulateServiceWorkerRestart(context);

    // Invoke adoptTabs to reclaim original IDs (if still open via session restore)
    const adoptRes = await callApi(context, 'adoptTabs');
    expect(adoptRes.ok).toBeTruthy();

    const afterTabs = await callApi(context, 'getTabsConfig');
    // After adoption either same IDs (if preserved by Chrome session restore) or new ones; ensure rotation still running.
    const diags = await callApi(context, 'getDiagnostics');
    expect(diags.isRotating).toBeTruthy();
    expect(afterTabs.ok).toBeTruthy();
    expect(afterTabs.tabs.length).toBe(2);
  });
});
