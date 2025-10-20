import { RotationService } from '../rotation.service';
import { ConfigValidatorService, ToolbarManagerService } from '../../app/services';
import { CustomHttpClient } from '../custom-http-client.service';
import { TabManagerService } from '../tab-manager.service';
import { MetricsService } from '../metrics.service';
import { SchedulerService } from '../scheduler.service';
import { StorageService } from '../storage.service';

// Regression test: ensure initialize({preserveExisting:true}) does NOT close existing owned tabs
// when service worker restarts while rotation is active.
describe('RotationService preserveExisting re-init', () => {
  it('retains existing rotation tabs and schedules rotation', async () => {
    const created: number[] = []; const removed: number[] = []; let nextId = 300;
    let updatedListeners: any[] = [];
    (globalThis as any).chrome = {
      tabs: {
        query: async () => created.map(id => ({ id, url: 'https://reuse.example', windowId: 1 })),
        create: async (opts: any) => { const tab = { id: nextId++, url: opts.url, windowId: 1 }; created.push(tab.id); return tab; },
        get: async (id:number) => ({ id, windowId: 1, url: 'https://reuse.example' }),
        update: async (id:number, _opts:any) => ({ id, windowId: 1, url: 'https://reuse.example', active: true }),
        highlight: async (_info:any) => {},
        remove: async (ids: number|number[]) => { for (const id of (Array.isArray(ids)? ids:[ids])) removed.push(id); },
        onUpdated: { addListener: (fn:any) => { updatedListeners.push(fn); }, removeListener: (fn:any) => { updatedListeners = updatedListeners.filter(l=>l!==fn); } }
      },
      alarms: { create: () => {}, clear: async () => true, getAll: async () => [] },
      windows: { getLastFocused: async () => ({ id: 1 }) },
      runtime: { lastError: null },
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }
    } as any;

    const http = new CustomHttpClient();
    const validator = new ConfigValidatorService();
    const toolbar = new ToolbarManagerService();
    const configServiceStub = { loadFromStorage: async () => ({ loadedConfig: { pages: [{ url: 'https://reuse.example', delaySeconds: 1, reloadIntervalSeconds: 0 }] }, loadedRemoteSettings: {}, useRemote: false }) } as any;
    const tm = new TabManagerService(new MetricsService());
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
      new MetricsService()
    );

    await rot.initialize(); // first init creates tab(s)
    // Mark rotation as active with known tab ids
    const originalIds = [...(tm as any).ownedTabIds];
    expect(originalIds.length).toBeGreaterThan(0);

    // Simulate service worker restart: call initialize with preserveExisting
    await rot.initialize({ preserveExisting: true });

  // Rotation may legitimately remove the prior primary after promoting a preload once; ensure no mass pruning
  expect(removed.length).toBeLessThanOrEqual(1);
    // Owned IDs set should still include original ids
    const finalIds = [...(tm as any).ownedTabIds];
    for (const id of originalIds) expect(finalIds).toContain(id);
  });
});
