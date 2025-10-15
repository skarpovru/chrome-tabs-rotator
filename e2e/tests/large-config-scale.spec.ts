import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';
import { callE2E as callApi } from '../utils/call-e2e-api';

test.describe('Large config scale @heavy', () => {
  test.setTimeout(60000);
  test('creates 30 pages and advances first few rotations', async ({ ext }) => {
  const { context } = ext;
    await waitForWorkerApi(context);
    const pages = Array.from({ length: 30 }).map((_, i) => ({ url: `https://example.com/scale${i}`, delaySeconds: 1, reloadIntervalSeconds: 0 }));
    await callApi(context, 'startWithConfig', { pages, isFullscreen: false, preventWindowFocus: false });
    await waitForTabIds(context, pages.length); // ensure all created
    const before = await callApi(context, 'getCurrentIndex');
    for (let i=0;i<5;i++) await callApi(context, 'rotateOnce');
    const after = await callApi(context, 'getCurrentIndex');
    expect(after).not.toBe(before);
  });
});
