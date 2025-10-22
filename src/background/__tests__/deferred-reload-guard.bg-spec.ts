// <reference types="jasmine" />
import { RotationService } from '../rotation.service';
import { TabConfig, TabsConfig } from '../../app/models';

describe('RotationService - Deferred reload guard single increment', () => {
  let rotation: RotationService; let cfg: TabConfig; let getActiveSpy: any;
  beforeEach(()=>{
    rotation = new RotationService({} as any, {} as any, {} as any);
    cfg = new TabConfig({ page: { url: 'https://guard.test', delaySeconds:3, reloadIntervalSeconds:5 } as any, tabId: 10, tabIdReady:true });
    (rotation as any)._tabsConfig = new TabsConfig({ tabs:[cfg, new TabConfig({ page: { url:'https://other.test', delaySeconds:3, reloadIntervalSeconds:5 } as any, tabId:11, tabIdReady:true })] });
    getActiveSpy = jasmine.createSpy('get').and.callFake(async()=> ({ id:10, active:true }));
    (globalThis as any).chrome = { tabs: { get: getActiveSpy, reload: jasmine.createSpy('reload'), query: jasmine.createSpy('query').and.resolveTo([{ id:10, active:true }]) }, alarms: { create: jasmine.createSpy('alarm.create'), clear: jasmine.createSpy('alarm.clear'), getAll: jasmine.createSpy('alarm.getAll').and.resolveTo([]) }, windows: { getLastFocused: jasmine.createSpy('getLastFocused').and.resolveTo({ id:1 }) } };
  });
  it('increments deferred count only once within guard window', async ()=>{
    await rotation.onReloadAlarm(10);
    expect(cfg.deferredReloadDue).toBeTrue();
    const firstCount = cfg.reloadDeferredCount;
    // Second alarm quickly: should NOT increment again (guard 2s)
    await rotation.onReloadAlarm(10);
    expect(cfg.reloadDeferredCount).toBe(firstCount);
  });
});
