// <reference types="jasmine" />
import { TabLifecycleService } from '../tab-lifecycle.service';
import { TabManagerService } from '../tab-manager.service';
import { SchedulerService } from '../scheduler.service';
import { MetricsService } from '../metrics.service';
import { TabConfig, TabsConfig } from '../../app/models';

describe('TabLifecycleService - Fallback keeps old primary when preload fails', () => {
  let lifecycle: TabLifecycleService; let tabManager: TabManagerService; let scheduler: SchedulerService; let metrics: MetricsService;
  let created:number[]=[]; let removed:number[]=[]; let reloaded:number[]=[];
  beforeEach(()=>{
    created=[]; removed=[]; reloaded=[];
    (globalThis as any).chrome = { tabs: {
      create: jasmine.createSpy('create').and.callFake(async (opts:any)=> { const id=500+created.length; created.push(id); return { id, url: opts.url, windowId:1 }; }),
      remove: jasmine.createSpy('remove').and.callFake(async (id:number)=> { removed.push(id); }),
      reload: jasmine.createSpy('reload').and.callFake(async (id:number)=> { reloaded.push(id); }),
      get: jasmine.createSpy('get').and.callFake(async (id:number)=> ({ id, windowId:1, active:false })),
      onUpdated: { addListener: () => {}, removeListener: () => {} }
    } }; metrics=new MetricsService(); tabManager=new TabManagerService(metrics); scheduler=new SchedulerService(); lifecycle=new TabLifecycleService(tabManager,scheduler,metrics);
  });
  it('removes failed preload and reloads primary in-place', async ()=>{
    const cfg = new TabConfig({ page: { url: 'https://fallback.test', delaySeconds:2, reloadIntervalSeconds: 5 } as any, tabId: 123, tabIdReady:true });
    const tabsConfig = new TabsConfig({ tabs:[cfg] });
    // Preload will be created but never set ready
    await lifecycle.handleReloadAlarm(123, tabsConfig, async ()=>{}, async ()=>{}, async ()=>{});
    expect(created.length).toBe(1);
    expect(cfg.nextTabId).toBe(0); // dropped
    expect(reloaded).toContain(123);
  });
});
