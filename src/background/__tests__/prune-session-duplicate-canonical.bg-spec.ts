// <reference types="jasmine" />
import { RotationService } from '../rotation.service';
import { ConfigValidatorService, ToolbarManagerService } from '../../app/services';
import { CustomHttpClient } from '../custom-http-client.service';
import { installChromeWithStorage } from './test-helpers/rotation-service-harness';

/**
 * Ensures a session-restored tab whose URL differs only by trailing slash does NOT
 * result in duplicate creation when config lists the canonical form.
 */
describe('RotationService canonical prune of session-restored duplicate', () => {
  let service: RotationService;
  const cfg = { pages: [
    { url: 'https://www.fail.com', delaySeconds: 5, reloadIntervalSeconds: 0 }
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
    // Simulate browser restart: a previously failed cert tab was session restored with a trailing slash variant
    // We pre-populate chrome.tabs.query() to return the restored tab BEFORE initialize() runs.
    let idCounter = 200;
    const tabs: Record<number, any> = {};
    const restored = { id: ++idCounter, windowId: 1, url: 'https://www.fail.com/' }; // trailing slash variant
    tabs[restored.id] = restored;
    installChromeWithStorage({
      tabs: {
        create: jasmine.createSpy('create').and.callFake(async (opts: any) => { const id = ++idCounter; const t = { id, windowId: 1, url: opts.url }; tabs[id] = t; return t; }),
        get: jasmine.createSpy('get').and.callFake(async (id:number) => { if (!tabs[id]) throw new Error('No tab'); return tabs[id]; }),
        update: jasmine.createSpy('update').and.callFake(async (id:number,_opts:any)=> { if (!tabs[id]) throw new Error('No tab'); return tabs[id]; }),
        query: jasmine.createSpy('query').and.callFake(async () => Object.values(tabs)),
        highlight: jasmine.createSpy('highlight').and.resolveTo({} as any),
        onUpdated: { addListener: () => {}, removeListener: () => {} }
      },
      windows: { getLastFocused: jasmine.createSpy('getLastFocused').and.resolveTo({ id: 1 }) },
      alarms: { create: jasmine.createSpy('alarm.create'), clear: jasmine.createSpy('alarm.clear'), getAll: jasmine.createSpy('alarm.getAll').and.resolveTo([]) }
    });
    service = new RotationService(new CustomHttpClient(), new ConfigValidatorService(), new ToolbarManagerService());
    mockStorageConfig();
    await service.initialize();
  });

  it('does not create a second duplicate tab for trailing slash variant', async () => {
    const tm = (service as any).tabManager;
    const tabsCfg = tm.tabsConfig;
    // After initialization, either the restored tab was adopted or replaced; but there must be exactly 1 primary.
    expect(tabsCfg.tabs.length).toBe(1);
    const t0 = tabsCfg.tabs[0];
    expect(t0.page.url).toBe('https://www.fail.com'); // config URL
    // Ensure no second tab with same logical URL exists among tracked primaries
  const ids = tabsCfg.tabs.map((t: any) => t.tabId).filter((id: number) => id > 0);
    expect(ids.length).toBe(1);
    // And chrome.tabs.create should have been called at most once (either adoption or recreation path)
  const createSpy = chrome.tabs.create as any;
  const createCalls = createSpy && createSpy.calls ? createSpy.calls.count() : 0;
  expect(createCalls).toBeLessThan(2);
  });
});
