import { RotationService } from '../rotation.service';
import { ConfigValidatorService, ToolbarManagerService } from '../../app/services';
import { CustomHttpClient } from '../custom-http-client.service';
import { TabManagerService } from '../tab-manager.service';
import { MetricsService } from '../metrics.service';
import { SchedulerService } from '../scheduler.service';
import { StorageService } from '../storage.service';

// This spec ensures a session-restored tab (same URL as first rotation page) is pruned and replaced by a newly created owned tab.
describe('RotationService prunePreexistingRotationTabs', () => {
  it('removes session-restored duplicate tab not tracked', async () => {
    const createdTabs: any[] = [];
    const removed: number[] = [];
    const pageUrl = 'https://prune.example';
    let nextId = 200;
    let updatedListeners: any[] = [];
    (globalThis as any).chrome = {
      tabs: {
        query: async () => ([
          { id: 50, url: pageUrl, windowId: 1 } // session-restored stray
        ]),
        create: async (opts: any) => { const tab = { id: nextId++, url: opts.url, windowId: 1, active: !!opts.active }; createdTabs.push(tab); return tab; },
        get: async (id:number) => ({ id, url: pageUrl, windowId: 1 }),
        update: async (id:number, _opts:any) => ({ id, url: pageUrl, windowId: 1, active: true }),
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
    const configServiceStub = { loadFromStorage: async () => ({ loadedConfig: { pages: [{ url: pageUrl, delaySeconds: 5, reloadIntervalSeconds: 0 }] }, loadedRemoteSettings: {}, useRemote: false }) } as any;
    const rot = new RotationService(
      http,
      validator,
      toolbar,
      configServiceStub,
      undefined,
      undefined,
      new TabManagerService(new MetricsService()),
      undefined,
      undefined,
      new SchedulerService(),
      new StorageService(),
      new MetricsService()
    );

  await rot.initialize();
  // Simulate tab load completion to resolve waitForInitialLoad early
  updatedListeners.forEach(l => l(createdTabs[0].id, { status: 'complete' }));
    // Expect the stray tab (id 50) to have been removed, and a new owned tab created instead.
    expect(removed).toContain(50);
  // Depending on timing, preload warming may add a second tab; assert at least one created
  expect(createdTabs.length).toBeGreaterThanOrEqual(1);
    expect(createdTabs[0].url).toBe(pageUrl);
  });
});
