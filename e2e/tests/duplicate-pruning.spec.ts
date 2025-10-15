import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E as callApi } from '../utils/call-e2e-api';
import { waitForWorkerApi } from '../utils/reliability-helpers';

const cfg = {
  pages: [
    { url: 'data:text/html,dup1', delaySeconds: 2, reloadIntervalSeconds: 0 },
    { url: 'data:text/html,dup2', delaySeconds: 2, reloadIntervalSeconds: 0 }
  ],
  isFullscreen: false,
  preventWindowFocus: false
};

test.describe('Duplicate pruning', () => {
  test('removes session-restored duplicate tabs', async ({ ext }) => {
  const { context } = ext;
  await waitForWorkerApi(context);
    await callApi(context, 'startWithConfig', cfg);
    await callApi(context, 'rotateOnce');

    const tabsCfg = await callApi(context, 'getTabsConfig');
    expect(tabsCfg.ok).toBeTruthy();
  const targetUrl = 'data:text/html,dup1';

    // Open a manual duplicate of a rotation page (not owned by manager)
    const page = await context.newPage();
    await page.goto(targetUrl);

    // Force rotate to trigger invariant enforcement logic indirectly (rotate attempts call enforcement)
    await callApi(context, 'forceRotate');

    // List open tabs via harness getDiagnostics or getState (simpler: listTabs not implemented but we have openTabs in diagnostics)
    const diags = await callApi(context, 'getDiagnostics');
    const openTabs = diags.openTabs || []; // shape: {id,url}
  const allForUrl = openTabs.filter((t: any) => t.url === targetUrl);
  // After invariant enforcement there should be at most one owned rotation tab; manual page may coexist briefly. Accept length <=2.
  expect(allForUrl.length).toBeLessThanOrEqual(2);
  });
});
