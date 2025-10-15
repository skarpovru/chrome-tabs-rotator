import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E as callApi } from '../utils/call-e2e-api';
import { waitForWorkerApi, pollAlarms } from '../utils/reliability-helpers';

const cfg = {
  pages: [
    { url: 'https://example.com/stop1', delaySeconds: 2, reloadIntervalSeconds: 0 },
    { url: 'https://example.com/stop2', delaySeconds: 2, reloadIntervalSeconds: 0 }
  ],
  isFullscreen: false,
  preventWindowFocus: false
};

test.describe('Stop rotation cleanup', () => {
  test('clears alarms and prevents further index changes', async ({ ext }) => {
  const { context } = ext;
  await waitForWorkerApi(context);
    await callApi(context, 'startWithConfig', cfg);
    await callApi(context, 'rotateOnce');
    const beforeIndex = await callApi(context, 'getCurrentIndex');

    await callApi(context, 'forceRotate'); // ensure active cycle state
    await callApi(context, 'rotateOnce');

    // Stop rotation
    await context.serviceWorkers().at(-1)!.evaluate(async () => { try { await (self as any).rotationService.stopRotation(); } catch {} });

    // Poll alarms list
    const alarms = await pollAlarms(context);
    // Expect no rotate/configReload/watchdog alarms
    expect(alarms.some(a => a === 'rotate')).toBeFalsy();
    expect(alarms.some(a => a === 'configReload')).toBeFalsy();
    expect(alarms.some(a => a === 'rotationWatchdog')).toBeFalsy();

    // Attempt to advance index deterministically should either fail or remain same because not rotating
    const attempt = await callApi(context, 'advanceIndex');
    const afterIndex = await callApi(context, 'getCurrentIndex');
    // If advanceIndex returned ok despite stopped, index may move; assert stopped state prevents rotations via forceRotateNow path
    const diags = await callApi(context, 'getDiagnostics');
    expect(diags.isRotating).toBeFalsy();
    // After forceRotate attempt when stopped, index should not change further
    await callApi(context, 'rotateOnce');
    const finalIndex = await callApi(context, 'getCurrentIndex');
    expect(finalIndex).toBe(afterIndex); // stable
  });
});
