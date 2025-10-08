import { TabLifecycleService } from '../tab-lifecycle.service';
import { TabManagerService } from '../tab-manager.service';
import { SchedulerService } from '../scheduler.service';
import { MetricsService } from '../metrics.service';
import { TabsConfig, TabConfig, PageConfig } from '../../app/models';

// Additional edge-focused specs beyond existing reload test.

describe('TabLifecycleService edge cases', () => {
  let lifecycle: TabLifecycleService; let tabManager: TabManagerService; let scheduler: SchedulerService; let metrics: MetricsService;
  const created: number[] = [];
  beforeEach(() => {
    (globalThis as any).chrome = {
      tabs: {
        reload: jasmine.createSpy('reload'),
        create: jasmine.createSpy('create').and.callFake(async (opts: any) => { const id = 500 + created.length; created.push(id); return { id, windowId: 1, url: opts.url }; }),
        get: jasmine.createSpy('get').and.callFake(async (id:number)=>({ id, windowId:1 })),
        onUpdated: { addListener: () => {}, removeListener: () => {} }
      }
    };
    metrics = new MetricsService();
    tabManager = new TabManagerService(metrics);
    scheduler = new SchedulerService();
    lifecycle = new TabLifecycleService(tabManager, scheduler, metrics);
  });

  it('no-op when alarm tab id not in config', async () => {
    const cfg = new TabsConfig();
    const page: PageConfig = { url: 'https://x', delaySeconds: 1 } as any;
    cfg.tabs.push(new TabConfig({ page, active: true }));
    await lifecycle.handleReloadAlarm(999, cfg, async () => {}, async () => {}, async () => {});
    expect((chrome.tabs.reload as any).calls.count()).toBe(0);
  });

  it('recovers by creating tab when both primary and preload missing for target', async () => {
    const cfg = new TabsConfig();
    const page: PageConfig = { url: 'https://y', delaySeconds: 1 } as any;
    const tabCfg = new TabConfig({ page, active: true });
    cfg.tabs.push(tabCfg);
    let saved: number[] = [];
    await lifecycle.handleReloadAlarm(0, cfg, async (tc) => {
      await tabManager.createTab(tc, async (id:number)=> { tc.tabId = id; tc.tabIdReady = true; });
    }, async ids => { saved = ids; }, async () => {});
    expect(created.length).toBe(1);
    expect(saved).toContain(created[0]);
  });

  it('reloads preload tab when available', async () => {
    const cfg = new TabsConfig();
    const page: PageConfig = { url: 'https://pre', delaySeconds: 1 } as any;
    const tabCfg = new TabConfig({ page, active: true });
    tabCfg.tabId = 700; tabCfg.tabIdReady = true;
    tabCfg.nextTabId = 701; tabCfg.nextTabIdReady = true;
    cfg.tabs.push(tabCfg);
    await lifecycle.handleReloadAlarm(701, cfg, async () => {}, async () => {}, async () => {});
    expect((chrome.tabs.reload as any).calls.first().args[0]).toBe(701);
  });
});
