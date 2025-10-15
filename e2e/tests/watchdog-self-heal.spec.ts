import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E as callApi } from '../utils/call-e2e-api';
import { waitForWorkerApi } from '../utils/reliability-helpers';

const cfg = {
  pages: [
    { url: 'https://example.com/a', delaySeconds: 2, reloadIntervalSeconds: 0 },
    { url: 'https://example.com/b', delaySeconds: 2, reloadIntervalSeconds: 0 },
    { url: 'https://example.com/c', delaySeconds: 2, reloadIntervalSeconds: 0 }
  ],
  isFullscreen: false,
  preventWindowFocus: false
};

test.describe('Watchdog self-heal', () => {
  test('advances or recreates when rotate alarm missing', async ({ ext }) => {
  const { context } = ext;
  const worker = await waitForWorkerApi(context);
    await callApi(context, 'startWithConfig', cfg);
    await callApi(context, 'rotateOnce');
    const beforeIndex = await callApi(context, 'getCurrentIndex');

    // Clear rotate alarm directly to simulate stall
    await worker.evaluate(async () => { try { await chrome.alarms.clear('rotate'); } catch {} });

    const result = await callApi(context, 'triggerWatchdog');
    expect(result.ok).toBeTruthy();
    // Expect index changed OR fallbackAdvance flag set
    const afterIndex = await callApi(context, 'getCurrentIndex');
    expect(afterIndex).not.toBe(beforeIndex); // due to fallback or normal rotation
  });

  test('heals after a rotation tab is manually closed', async ({ ext }) => {
  const { context } = ext;
  const worker = await waitForWorkerApi(context);
    await callApi(context, 'startWithConfig', cfg);
    await callApi(context, 'rotateOnce');

    const tabsCfg1 = await callApi(context, 'getTabsConfig');
    expect(tabsCfg1.ok).toBeTruthy();
    const firstTabId = tabsCfg1.tabs[0].tabId;

    // Close one owned tab
    await callApi(context, 'closeTab', firstTabId);

    const beforeHealTabs = await callApi(context, 'getTabsConfig');
    // Tab may still appear briefly until cleanup; trigger watchdog to force invariant enforcement
    const wdRes = await callApi(context, 'triggerWatchdog');
    expect(wdRes.ok).toBeTruthy();

    const afterHealTabs = await callApi(context, 'getTabsConfig');
    expect(afterHealTabs.ok).toBeTruthy();
    // Ensure either tabId replaced or removed (not the same ID in position 0 if recreated)
    const newFirstId = afterHealTabs.tabs[0].tabId;
    expect(newFirstId === firstTabId).toBeFalsy();
  });
});
