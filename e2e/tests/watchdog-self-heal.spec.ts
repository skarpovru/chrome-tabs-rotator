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

    // Poll for heal outcome: either tabId changes OR activation history shows new success at index 0 after close
    let healed = false;
    let newFirstId: number = firstTabId;
    let activationAdvanced = false;
    const start = Date.now();
    while (Date.now() - start < 4000) { // up to 4s
      const afterHealTabs = await callApi(context, 'getTabsConfig');
      const histResp = await callApi(context, 'getActivationHistory');
      const history = histResp.history || [];
      newFirstId = afterHealTabs.tabs[0].tabId;
      // Activation entry for index 0 with success after close time (approx by loop start)
      activationAdvanced = history.some((h: any) => h.pageIndex === 0 && h.success && h.at > start);
      if (newFirstId !== firstTabId || activationAdvanced) { healed = true; break; }
      await new Promise(r => setTimeout(r, 150));
    }
    if (!healed) {
      const diag = await callApi(context, 'getDiagnostics');
      throw new Error('Watchdog did not heal (tabId unchanged and no activation history advance) firstTabId=' + firstTabId + ' newFirstId=' + newFirstId + ' diagnostics=' + JSON.stringify(diag));
    }
    // Assert healing criteria
    if (newFirstId === firstTabId) {
      expect(activationAdvanced).toBeTruthy(); // unchanged id acceptable only if activation advanced
    } else {
      expect(newFirstId).not.toBe(firstTabId);
    }
  });
});
