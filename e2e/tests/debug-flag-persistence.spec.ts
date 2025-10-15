import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { simulateServiceWorkerRestart } from '../utils/launch-extension';
import { waitForWorkerApi } from '../utils/reliability-helpers';
import { callE2E as callApi } from '../utils/call-e2e-api';

test.describe('Debug activation logging persistence', () => {
  test('flag survives restart', async ({ ext }) => {
    const { context } = ext;
    await waitForWorkerApi(context);
    await callApi(context, 'startWithConfig', { pages: [ { url: 'https://example.com/d1', delaySeconds: 2, reloadIntervalSeconds: 0 } ], isFullscreen: false, preventWindowFocus: false });
    // Enable via worker storage
    const worker = context.serviceWorkers().at(-1)!;
    await worker.evaluate(async () => { const rs:any = (self as any).rotationService; await rs.storage.set({ DebugActivationLogging: true }); });
    await simulateServiceWorkerRestart(context);
    const diags = await callApi(context, 'getDiagnostics');
    expect(diags.rotationState || diags.localConfig).toBeDefined();
    const debugFlag = diags.debugActivationLogging || diags.rotationState?.debugActivationLogging;
    // Allow absence in diagnostics; query storage directly as fallback
    if (!debugFlag) {
      const worker2 = context.serviceWorkers().at(-1)!;
      const stored = await worker2.evaluate(async () => { try { return await (self as any).rotationService.storage.get('DebugActivationLogging'); } catch { return undefined; } });
      expect(stored).toBeTruthy();
    } else {
      expect(debugFlag).toBeTruthy();
    }
  });
});
