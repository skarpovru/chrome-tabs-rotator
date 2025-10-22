import { TabLifecycleService } from '../tab-lifecycle.service';
import { TabManagerService } from '../tab-manager.service';
import { SchedulerService } from '../scheduler.service';
import { MetricsService } from '../metrics.service';
import { TabConfig, TabsConfig } from '../../app/models';

// Chrome stubs
let nextId = 4000; const tabs: any[] = [];
(globalThis as any).chrome = {
  tabs: {
    create: async (opts: any) => { const id = ++nextId; const tab = { id, windowId: 1, url: opts.url, active: false }; tabs.push(tab); return tab; },
    update: async ()=>{}, remove: async (id:number)=>{ const i=tabs.findIndex(t=>t.id===id); if(i>=0) tabs.splice(i,1); }, get: async (id:number)=>{ const t=tabs.find(t=>t.id===id); if(!t) throw new Error('no'); return t; }, reload: async()=>{}, query: async()=>tabs,
    onUpdated: { addListener: ()=>{} }, onRemoved: { addListener: ()=>{} },
  }
} as any;

// Minimal metrics stub
class NoopMetrics extends MetricsService { constructor(){ super(); } }

// Minimal scheduler stub (immediate resolution)
class NoopScheduler extends SchedulerService { override async scheduleReload(id:number,_s:number){ (this as any).__scheduled = id; } }

describe('preload failure retention', () => {
  it('discards failed preload and retains primary tab', async () => {
    const tm = new TabManagerService(new NoopMetrics());
    const sched = new NoopScheduler();
    const metrics = new NoopMetrics();
    const lifecycle = new TabLifecycleService(tm, sched, metrics);

    // Seed config with single page primary
    const cfg = new TabConfig({ page: { url: 'https://preload-retain.test', delaySeconds: 2, reloadIntervalSeconds: 1 } as any });
    tm.tabsConfig = new TabsConfig(); tm.tabsConfig.tabs.push(cfg);
    await tm.createTab(cfg, async()=>{}); // creates primary (tabId)
    const originalPrimary = cfg.tabId;

    // Monkey patch waitForInitialLoad to simulate timeout failure (no readiness)
    (lifecycle as any).waitForInitialLoad = async (tc: TabConfig)=>{ tc.lastPreloadWaitOutcome='timeout'; tc.nextTabIdReady = false; tc.preloadCreationAt = Date.now()-5; tc.preloadOnUpdatedCount = 0; };

    // Invoke handleReloadAlarm which will attempt preload & then discard
    await lifecycle.handleReloadAlarm(originalPrimary, tm.tabsConfig, async()=>{}, async()=>{}, async()=>{});

    expect(cfg.tabId).toBe(originalPrimary);
    expect(cfg.nextTabId).toBe(0);
    expect((cfg.preloadFailureCount||0)).toBeGreaterThan(0);
    // Ensure primary not suspended
    expect(cfg.suspended).not.toBeTrue();
  });
});
