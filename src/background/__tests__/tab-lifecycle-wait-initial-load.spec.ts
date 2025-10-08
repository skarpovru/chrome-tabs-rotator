import { TabLifecycleService } from '../tab-lifecycle.service';
import { TabConfig } from '../../app/models';

// Local chrome mock with onUpdated listener capture so we can simulate load completion
describe('TabLifecycleService.waitForInitialLoad', () => {
  let listeners: Array<(tabId: number, changeInfo: any) => void> = [];

  beforeEach(() => {
    listeners = [];
    (globalThis as any).chrome = {
      tabs: {
        onUpdated: {
          addListener: (fn: any) => listeners.push(fn),
          removeListener: (fn: any) => { listeners = listeners.filter(l => l !== fn); }
        },
        get: async (id: number) => ({ id, windowId: 1 }),
      },
      runtime: { lastError: null }
    } as any;
  });

  it('marks primary tab ready and resolves early when update complete event fires', async () => {
    const svc = new TabLifecycleService({} as any, {} as any, {} as any);
    const tabCfg = new TabConfig({ page: { url: 'https://early.test', delaySeconds: 5, reloadIntervalSeconds: 0 } as any, active: true });
    tabCfg.tabId = 123; // simulate already created tab
    tabCfg.tabIdReady = false;

    const start = Date.now();
    const p = svc.waitForInitialLoad(tabCfg, 1000);
    // Fire simulated completion shortly after registration
    setTimeout(() => {
      listeners.forEach(l => l(tabCfg.tabId!, { status: 'complete' }));
    }, 10);

    await p;
    const duration = Date.now() - start;
    expect(tabCfg.tabIdReady).toBeTrue();
    // Should resolve well before full timeout (and before 250ms fallback ideally)
    expect(duration).toBeLessThan(250);
  });

  it('resolves after timeout without setting flags when no events occur', async () => {
    const svc = new TabLifecycleService({} as any, {} as any, {} as any);
    const tabCfg = new TabConfig({ page: { url: 'https://timeout.test', delaySeconds: 5, reloadIntervalSeconds: 0 } as any, active: true });
    tabCfg.tabId = 456; // existing tab ID
    tabCfg.tabIdReady = false;

    const timeout = 120; // short timeout for test
    const start = Date.now();
    await svc.waitForInitialLoad(tabCfg, timeout);
    const duration = Date.now() - start;
    // Expect at least the timeout elapsed (allow slight scheduling delay)
    expect(duration).toBeGreaterThanOrEqual(timeout);
    // Should not have marked readiness since no event fired
    expect(tabCfg.tabIdReady).toBeFalse();
  });
});
