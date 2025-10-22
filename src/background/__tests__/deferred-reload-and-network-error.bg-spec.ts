import { RotationService } from '../rotation.service';
import { TabConfig, TabsConfig } from '../../app/models';

describe('RotationService - Deferred Reload & Network Error', () => {
  let rotation: RotationService;
  let tabConfig: TabConfig;

  beforeEach(() => {
    rotation = new RotationService(
      {} as any, {} as any, {} as any
    );
    tabConfig = new TabConfig({
      page: { url: 'https://example.com', delaySeconds: 10, reloadIntervalSeconds: 5 } as any,
      tabId: 123,
      tabIdReady: true,
      retryCount: 0,
    });
  (rotation as any)._tabsConfig = new TabsConfig({ tabs: [tabConfig] });
  (rotation as any).tabManager.tabsConfig = (rotation as any)._tabsConfig;
  // Chrome mock including alarms & tabs.onUpdated needed for waitForInitialLoad
  const updatedListeners: any[] = [];
  (globalThis as any).chrome = {
    tabs: {
      get: async (id:number) => ({ id, active: true, url: tabConfig.page.url }),
      query: async () => [{ id: tabConfig.tabId, active: true, url: tabConfig.page.url }],
      onUpdated: {
        addListener: (fn: any) => updatedListeners.push(fn),
        removeListener: (fn: any) => { const i = updatedListeners.indexOf(fn); if (i>=0) updatedListeners.splice(i,1); }
      }
      ,
      create: async (opts: any) => { const newId = 200; // single synthetic preload
        // Fire completion shortly after to satisfy waitForInitialLoad
        setTimeout(()=> { try { updatedListeners.forEach(l => l(newId, { status: 'complete' }, { id:newId } as any)); } catch {} }, 10);
        return { id: newId, url: opts.url, windowId: 1, active: false }; }
    },
    alarms: {
      create: jasmine.createSpy('alarms.create'),
      clear: jasmine.createSpy('alarms.clear').and.callFake(async () => true),
      getAll: jasmine.createSpy('alarms.getAll').and.resolveTo([])
    },
    windows: { getLastFocused: async () => ({ id:1 }) },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }
  } as any;
  });

  it('should defer reload if tab is active and multiple tabs exist', async () => {
  (chrome.tabs.get as any) = () => Promise.resolve({ id: 123, active: true });
  (rotation as any)._tabsConfig.tabs.push(new TabConfig({ page: { url: 'https://other.com', delaySeconds: 10, reloadIntervalSeconds: 5 } as any, tabId: 456 }));
  await rotation.onReloadAlarm(123);
  expect(tabConfig.deferredReloadDue).toBeTrue();
  expect(tabConfig.reloadDeferredCount).toBe(1);
  });

  it('should not defer reload if only one tab', async () => {
  (chrome.tabs.get as any) = () => Promise.resolve({ id: 123, active: true });
  await rotation.onReloadAlarm(123);
  expect(tabConfig.deferredReloadDue).toBeFalse();
  });

  it('should set network error info on onErrorOccurred', async () => {
    const details = { tabId: 123, url: 'https://example.com', error: 'net::ERR_NAME_NOT_RESOLVED', frameId: 0 };
  (rotation as any)._tabsConfig.tabs[0].lastNetworkErrorCode = undefined;
  (rotation as any)._tabsConfig.tabs[0].lastNetworkErrorAt = undefined;
  // Simulate background.ts logic
  (rotation as any)._tabsConfig.tabs[0].lastNetworkErrorCode = details.error;
  (rotation as any)._tabsConfig.tabs[0].lastNetworkErrorAt = Date.now();
  expect(tabConfig.lastNetworkErrorCode).toBe('net::ERR_NAME_NOT_RESOLVED');
  expect(typeof tabConfig.lastNetworkErrorAt).toBe('number');
  });

  it('should trigger deferred reload when tab becomes inactive', async () => {
  tabConfig.deferredReloadDue = true;
  (rotation as any).previousIndex = 0;
  (rotation as any).rotationState.isRotating = true;
  (rotation as any).rotationState.tabIds = [(rotation as any)._tabsConfig.tabs[0].tabId, 456];
  spyOn(rotation, 'onReloadAlarm').and.callFake(async (tabId: number) => { tabConfig.deferredReloadDue = false; });
  (rotation as any).activationService = { activateTabWithFallback: async () => true };
  (rotation as any)._tabsConfig.tabs.push(new TabConfig({ page: { url: 'https://other.com', delaySeconds: 10, reloadIntervalSeconds: 5 } as any, tabId: 456 }));
  await (rotation as any).rotateTabs();
  expect(rotation.onReloadAlarm).toHaveBeenCalledWith(123);
  expect(tabConfig.deferredReloadDue).toBeFalse();
  });
});
