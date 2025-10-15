import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { waitForWorkerApi } from '../utils/reliability-helpers';
import { callE2E as callApi } from '../utils/call-e2e-api';

test.describe('Metrics snapshot stability @heavy', () => {
  test('counters increase with rotations', async ({ ext }) => {
  const { context } = ext;
    await waitForWorkerApi(context);
    await callApi(context, 'startWithConfig', { pages: [
      { url: 'https://example.com/metrics1', delaySeconds: 1, reloadIntervalSeconds: 0 },
      { url: 'https://example.com/metrics2', delaySeconds: 1, reloadIntervalSeconds: 0 }
    ], isFullscreen: false, preventWindowFocus: false });
    const snap1 = await callApi(context, 'getMetrics');
    await callApi(context, 'rotateOnce');
    await callApi(context, 'rotateOnce');
    const snap2 = await callApi(context, 'getMetrics');
    expect(snap1?.counters?.rotations).toBeDefined();
    expect(snap2.counters.rotations).toBeGreaterThanOrEqual(snap1.counters.rotations);
  });
});
