// <reference types="jasmine" />
import { RotationService } from '../rotation.service';
import { TabConfig, TabsConfig } from '../../app/models';

describe('RotationService - file:// in-place reload (configurable)', () => {
  let rotation: RotationService; let reloadCalls:number[]=[];
  beforeEach(()=>{
    (globalThis as any).chrome = { tabs: { reload: jasmine.createSpy('reload').and.callFake(async (id:number)=> { reloadCalls.push(id); }), get: jasmine.createSpy('get').and.callFake(async(id:number)=> ({ id, active:true })), query: jasmine.createSpy('query').and.resolveTo([{ id: 1, active:true }]) }, alarms: { create: jasmine.createSpy('alarm.create'), clear: jasmine.createSpy('alarm.clear'), getAll: jasmine.createSpy('alarm.getAll').and.resolveTo([]) }, windows: { getLastFocused: jasmine.createSpy('getLastFocused').and.resolveTo({ id:1 }) } };
    rotation = new RotationService({} as any, {} as any, {} as any);
    const cfg = new TabConfig({ page: { url: 'file:///C:/docs/report.pdf', delaySeconds:3, reloadIntervalSeconds:5 } as any, tabId: 55, tabIdReady:true });
    (rotation as any)._tabsConfig = new TabsConfig({ tabs:[cfg] });
    (rotation as any).rotationState.isRotating = true; (rotation as any).currentIndex = 0;
  });
  it('onReloadAlarm reloads file tab in-place when reuseLocalFileTabs=true', async ()=>{
    (rotation as any).currentConfig = { reuseLocalFileTabs: true };
    await rotation.onReloadAlarm(55);
    expect(reloadCalls).toContain(55);
    const cfg = (rotation as any)._tabsConfig.tabs[0];
    expect(cfg.nextTabId).toBe(0);
  });
});
