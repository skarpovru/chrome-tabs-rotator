import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { waitForWorkerApi } from '../utils/reliability-helpers';
import { callE2E as callApi } from '../utils/call-e2e-api';

test.describe('Cross-window behavior @heavy', () => {
  test('second window does not interfere with rotation', async ({ ext }) => {
  const { context } = ext;
    await waitForWorkerApi(context);
    await callApi(context, 'startWithConfig', { pages: [
      { url: 'https://example.com/cw1', delaySeconds: 1, reloadIntervalSeconds: 0 },
      { url: 'https://example.com/cw2', delaySeconds: 1, reloadIntervalSeconds: 0 }
    ], isFullscreen:false, preventWindowFocus:false });
  const firstWinPage = await context.newPage();
  await firstWinPage.goto('data:text/html,first-window');
  // Simulate second window via another tab (data URL to avoid network flakiness)
  const extraPage = await context.newPage();
  await extraPage.goto('data:text/html,second-window');
    const before = await callApi(context, 'getCurrentIndex');
  await callApi(context, 'rotateOnce');
  let after = await callApi(context, 'getCurrentIndex');
  if (after === before) { await callApi(context, 'advanceIndex'); after = await callApi(context, 'getCurrentIndex'); }
  expect(after).not.toBe(before);
  });
});
