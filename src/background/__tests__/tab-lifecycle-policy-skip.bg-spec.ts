// <reference types="jasmine" />
import { TabLifecycleService } from '../tab-lifecycle.service';
import { TabManagerService } from '../tab-manager.service';
import { SchedulerService } from '../scheduler.service';
import { MetricsService } from '../metrics.service';
import { TabConfig, TabsConfig, PageConfig } from '../../app/models';

/**
 * Verifies that file:// scheme pages are skipped for preload creation and primary is reloaded instead.
 */
describe('TabLifecycleService preload policy (file scheme behavior)', () => {
  let lifecycle: TabLifecycleService; let tabManager: TabManagerService; let scheduler: SchedulerService; let metrics: MetricsService;
  let created: number[] = []; let reloaded: number[] = []; let removed: number[] = [];

  beforeEach(() => {
    created = []; reloaded = []; removed = [];
    (globalThis as any).chrome = {
      tabs: {
        create: jasmine.createSpy('create').and.callFake(async (_opts: any) => { const id = 4000 + created.length; created.push(id); return { id, windowId: 1 }; }),
        remove: jasmine.createSpy('remove').and.callFake(async (id: number) => { removed.push(id); }),
        reload: jasmine.createSpy('reload').and.callFake(async (id: number) => { reloaded.push(id); }),
        get: jasmine.createSpy('get').and.callFake(async (id: number) => ({ id, windowId: 1 })),
        update: jasmine.createSpy('update'),
        onUpdated: { addListener: () => {}, removeListener: () => {} }
      }
    };
    metrics = new MetricsService();
    tabManager = new TabManagerService(metrics);
    scheduler = new SchedulerService();
    lifecycle = new TabLifecycleService(tabManager, scheduler, metrics);
  });

  it('does not create preload for file:// page when reuseLocalFileTabs=true', async () => {
    const page: PageConfig = { url: 'file:///C:/local/page1.html', delaySeconds: 5, reloadIntervalSeconds: 60 } as any;
    const cfg = new TabConfig({ page, active: true });
    cfg.tabId = 501; cfg.tabIdReady = true;
    const tabsConfig = new TabsConfig(); tabsConfig.tabs.push(cfg);

    await lifecycle.handleReloadAlarm(501, tabsConfig, async () => {}, async () => {}, async () => {}, { reuseLocalFileTabs: true });

    // Expect no preload tab creation attempt (create unused) and a fallback reload of primary
    expect(created.length).toBe(0);
    expect(reloaded).toContain(501);
    expect(cfg.nextTabId).toBe(0);
  });
});
