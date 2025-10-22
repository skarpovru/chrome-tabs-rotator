// <reference types="jasmine" />
import { RotationService } from '../rotation.service';
import { TabConfig, TabsConfig } from '../../app/models';

/**
 * Verifies background-only preload promotion: preload becomes primary without immediate activation.
 */
describe('RotationService - Preload promotion no activation', () => {
  let rotation: RotationService; let activationCalls: any[] = [];
  beforeEach(() => {
    activationCalls = [];
    let idCounter = 200;
    const tabs: Record<number, any> = {};
    (globalThis as any).chrome = {
      tabs: {
        create: jasmine.createSpy('create').and.callFake(async (opts:any)=> { const id = ++idCounter; const t={ id, windowId:1, url: opts.url, active:false }; tabs[id]=t; return t; }),
        get: jasmine.createSpy('get').and.callFake(async (id:number)=> { if(!tabs[id]) throw new Error('missing'); return tabs[id]; }),
        update: jasmine.createSpy('update').and.callFake(async (id:number, opts:any)=> { const t=tabs[id]; if(!t) throw new Error('missing'); if(opts.active) t.active=true; return t; }),
        query: jasmine.createSpy('query').and.callFake(async ()=> Object.values(tabs).filter(t=>t.active)),
        remove: jasmine.createSpy('remove').and.callFake(async (id:number)=> { delete tabs[id]; }),
        highlight: jasmine.createSpy('highlight'),
        onUpdated: { addListener: () => {}, removeListener: () => {} }
      },
      windows: { getLastFocused: jasmine.createSpy('getLastFocused').and.resolveTo({ id:1 }) },
      alarms: { create: jasmine.createSpy('alarm.create'), clear: jasmine.createSpy('alarm.clear'), getAll: jasmine.createSpy('alarm.getAll').and.resolveTo([]) }
    };
    // Provide storage.local for repository usage
    (globalThis as any).chrome.storage = { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } };
    rotation = new RotationService({} as any, {} as any, {} as any);
    (rotation as any).activationService = { activateTabWithFallback: async (tabId:number, pageIndex:number, src:string)=> { activationCalls.push({ tabId, pageIndex, src }); return true; } };
    (rotation as any).rotationState.isRotating = true;
    const primaryId = 101; tabs[primaryId] = { id: primaryId, url: 'https://p1', windowId:1, active:true };
    const preloadId = 102; tabs[preloadId] = { id: preloadId, url: 'https://p1', windowId:1, active:false };
    const cfg = new TabConfig({ page: { url: 'https://p1', delaySeconds:2, reloadIntervalSeconds:5 } as any, tabId: primaryId, tabIdReady:true, nextTabId: preloadId, nextTabIdReady:true });
    (rotation as any)._tabsConfig = new TabsConfig({ tabs: [cfg] });
    spyOn((rotation as any).tabManager, 'ensureTabExists').and.callFake(async (id:number)=> !!tabs[id]);
    (rotation as any).currentIndex = 0;
  });
  it('promotes preload without activating when old primary was not active', async () => {
    // Make old primary inactive
    const tabsCfg = (rotation as any)._tabsConfig.tabs[0];
    (chrome.tabs.get as any).and.callFake(async (id:number)=> ({ id, active:false, windowId:1 }));
    await (rotation as any).rotateTabs();
    expect(tabsCfg.tabId).toBe(102); // promoted
    expect(tabsCfg.nextTabId).toBe(0);
    // Only logical activation recorded
    expect(activationCalls.length).toBeGreaterThanOrEqual(1);
  });
});
