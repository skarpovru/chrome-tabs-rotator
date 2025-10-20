// <reference types="jasmine" />
import { RotationService } from '../rotation.service';
import { ConfigValidatorService, ToolbarManagerService } from '../../app/services';
import { CustomHttpClient } from '../custom-http-client.service';
import { installChromeWithStorage } from './test-helpers/rotation-service-harness';

/**
 * Tests for the resilience logic added to rotateTabs():
 *  - Promotion of nextTabId to primary when primary was closed
 *  - Recreation of placeholder when both ids missing
 */
describe('RotationService missing tab repair', () => {
  let service: RotationService;
  const cfg = { pages: [
    { url: 'https://example.com/a', delaySeconds: 3, reloadIntervalSeconds: 0 },
    { url: 'https://example.com/b', delaySeconds: 3, reloadIntervalSeconds: 0 }
  ], isFullscreen: false, preventWindowFocus: false } as any;

  function mockStorageConfig() {
    const storage = (service as any).storage;
    spyOn(storage, 'get').and.callFake(async (k: string) => {
      if (k === 'config') return cfg;
      if (k === 'rotationState') return { isRotating: true, tabIds: (service as any).rotationState.tabIds, currentIndex: 0 };
      return undefined;
    });
    const configService = (service as any).configService;
    spyOn(configService, 'loadFromStorage').and.resolveTo({ loadedConfig: cfg, loadedRemoteSettings: undefined, useRemote: false });
  }

  beforeEach(async () => {
    // chrome mock that allows create + get with programmable failures
    let idCounter = 100;
    const tabs: Record<number, any> = {};
    installChromeWithStorage({
      tabs: {
        create: jasmine.createSpy('create').and.callFake(async (opts: any) => { const id = ++idCounter; const t = { id, windowId: 1, url: opts.url }; tabs[id] = t; return t; }),
        get: jasmine.createSpy('get').and.callFake(async (id:number) => { if (!tabs[id]) throw new Error('No tab with id'); return tabs[id]; }),
        update: jasmine.createSpy('update').and.callFake(async (id:number, _opts:any)=> { if (!tabs[id]) throw new Error('No tab with id'); return tabs[id]; }),
        query: jasmine.createSpy('query').and.resolveTo([{ id: 101, url: 'about:blank', windowId: 1, active: true }]),
        highlight: jasmine.createSpy('highlight').and.resolveTo({} as any),
        onUpdated: { addListener: () => {}, removeListener: () => {} }
      },
      windows: { getLastFocused: jasmine.createSpy('getLastFocused').and.resolveTo({ id: 1 }) },
      alarms: { create: jasmine.createSpy('alarm.create'), clear: jasmine.createSpy('alarm.clear'), getAll: jasmine.createSpy('alarm.getAll').and.resolveTo([]) }
    });
    service = new RotationService(new CustomHttpClient(), new ConfigValidatorService(), new ToolbarManagerService());
    mockStorageConfig();
    await service.initialize();
    // capture current tabsConfig for mutation tests
    const tabsCfg = (service as any).tabsConfig;
    expect(tabsCfg.tabs.length).toBe(2);
    // Ensure preload warming ran (best-effort; may not create preloads immediately)
  });

  it('promotes nextTabId when primary missing (ensureTabExists false)', async () => {
    const tabsCfg = (service as any).tabsConfig as any;
    const first = tabsCfg.tabs[0];
    // Ensure rotateTabs will actually run (clear in-progress guard)
  (service as any).rotating = false; // clear internal guard
  (service as any).rotationState.isRotating = true; // mark rotating through state
    (service as any).currentIndex = 0;
    // Provide deterministic IDs
    const stalePrimary = 1111;
    const promotablePreload = 2222;
    first.tabId = stalePrimary; // will be reported missing by ensureTabExists
    first.tabIdReady = true;
    first.nextTabId = promotablePreload;
    first.nextTabIdReady = true;
    // ensureTabExists: primary returns false, preload returns true
    spyOn((service as any).tabManager, 'ensureTabExists').and.callFake(async (id:number)=> id === promotablePreload);
    const createSpy = spyOn<any>(service as any, 'createTab').and.callThrough();
    await (service as any).rotateTabs();
    expect(first.tabId).toBe(promotablePreload); // promoted
    expect(first.nextTabId).toBe(0); // cleared after promotion
    expect(createSpy).not.toHaveBeenCalled(); // promotion path, no recreation
  });

  it('recreates placeholder when both primary and preload missing', async () => {
    const tm = (service as any).tabManager;
    const tabsCfg = (service as any).tabsConfig as any;
    const first = tabsCfg.tabs[0];
    first.tabId = 999; first.nextTabId = 0; first.tabIdReady = false; first.nextTabIdReady = false;
    spyOn(tm, 'ensureTabExists').and.resolveTo(false);
    const createSpy = spyOn<any>(service as any, 'createTab').and.callThrough();
    await (service as any).rotateTabs();
    expect(createSpy).toHaveBeenCalled();
    expect(first.tabId > 0).toBeTrue();
  });
});
