// <reference types="jasmine" />
import { RotationService } from '../rotation.service';
import { TabConfig, TabsConfig } from '../../app/models';

describe('RotationService - Failure classification diagnostics', () => {
  let rotation: RotationService; let tc: TabConfig;
  beforeEach(()=>{
    rotation = new RotationService({} as any, {} as any, {} as any);
    tc = new TabConfig({ page: { url: 'https://classify.test', delaySeconds:3, reloadIntervalSeconds:5 } as any, tabId: 77, tabIdReady:true });
    (rotation as any)._tabsConfig = new TabsConfig({ tabs:[tc] });
    (rotation as any).tabManager.tabsConfig = (rotation as any)._tabsConfig; // keep synchronized
    (rotation as any).rotationState.isRotating = true;
    const updatedListeners: any[] = [];
    (globalThis as any).chrome = {
      tabs: {
        get: jasmine.createSpy('get').and.resolveTo({ id:77, active:true, url: tc.page.url }),
        query: jasmine.createSpy('query').and.resolveTo([{ id:77, active:true, url: tc.page.url }]),
        onUpdated: {
          addListener: (fn: any) => updatedListeners.push(fn),
          removeListener: (fn: any) => { const i = updatedListeners.indexOf(fn); if (i>=0) updatedListeners.splice(i,1); }
        }
      },
      windows: { getLastFocused: jasmine.createSpy('getLastFocused').and.resolveTo({ id:1 }) },
      alarms: {
        create: jasmine.createSpy('alarms.create'),
        clear: jasmine.createSpy('alarms.clear').and.resolveTo(true),
        getAll: jasmine.createSpy('alarms.getAll').and.resolveTo([])
      },
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }
    } as any;
  });
  it('sets cert classification on network error code', async ()=>{
    tc.lastNetworkErrorCode = 'net::ERR_CERT_COMMON_NAME_INVALID';
    await (rotation as any).onHandleError(77, tc.page.url);
    expect(tc.failureClassification).toBe('cert');
  });
});
