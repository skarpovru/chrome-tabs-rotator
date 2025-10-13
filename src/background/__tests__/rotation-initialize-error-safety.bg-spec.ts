import { RotationService } from '../rotation.service';
import { ConfigValidatorService, ToolbarManagerService } from '../../app/services';
import { CustomHttpClient } from '../custom-http-client.service';
import { TabManagerService } from '../tab-manager.service';
import { MetricsService } from '../metrics.service';
import { SchedulerService } from '../scheduler.service';
import { StorageService } from '../storage.service';

/**
 * Ensures that an exception thrown mid-initialize does not destructively prune or lose existing owned tabs.
 */

describe('RotationService initialize error safety', () => {
  it('retains previously owned tabs when createTabs throws', async () => {
    const metrics = new MetricsService();
    let ownedSeedIds = [900, 901];

    (globalThis as any).chrome = {
      tabs: {
        query: async () => ownedSeedIds.map(id => ({ id, url: 'https://safe.example', windowId: 1 })),
        get: async (id:number) => ({ id, url: 'https://safe.example', windowId: 1 }),
        create: async () => { throw new Error('forced create failure'); },
        remove: async () => { throw new Error('Should not remove during failure'); },
        onUpdated: { addListener: () => {}, removeListener: () => {} }
      },
      alarms: { create: () => {}, clear: async () => true, getAll: async () => [] },
      windows: { getLastFocused: async () => ({ id: 1 }) },
      runtime: { lastError: null },
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
      action: { setIcon: () => {} }
    } as any;

    const http = new CustomHttpClient();
    const validator = new ConfigValidatorService();
    const toolbar = new ToolbarManagerService();
    const configServiceStub = { loadFromStorage: async () => ({ loadedConfig: { pages: [{ url: 'https://safe.example', delaySeconds: 1, reloadIntervalSeconds: 0 }] }, loadedRemoteSettings: {}, useRemote: false }) } as any;
    const tm = new TabManagerService(metrics);
    // Pre-seed owned set manually to emulate prior successful rotation.
    (tm as any).ownedTabIds = new Set<number>(ownedSeedIds);

    const rot = new RotationService(
      http,
      validator,
      toolbar,
      configServiceStub,
      undefined,
      undefined,
      tm,
      undefined,
      undefined,
      new SchedulerService(),
      new StorageService(),
      metrics
    );

    let threw = false;
    try {
      await rot.initialize();
    } catch (e:any) {
      threw = true;
      expect(e.message).toContain('forced create failure');
    }
    expect(threw).toBeTrue();

    const finalOwned = [...(tm as any).ownedTabIds];
    expect(finalOwned.sort()).toEqual(ownedSeedIds.sort());
  });
});
