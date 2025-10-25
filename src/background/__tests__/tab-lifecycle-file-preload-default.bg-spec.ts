// <reference types="jasmine" />
import { TabLifecycleService } from '../tab-lifecycle.service';
import { TabManagerService } from '../tab-manager.service';
import { SchedulerService } from '../scheduler.service';
import { MetricsService } from '../metrics.service';
import { TabConfig, TabsConfig, PageConfig } from '../../app/models';

/**
 * Verifies that by default (reuseLocalFileTabs === false) a file:// page uses the preload strategy
 * instead of the legacy in-place reload path.
 */
describe('TabLifecycleService default file:// preload (reuseLocalFileTabs=false)', () => {
  let lifecycle: TabLifecycleService; let tabManager: TabManagerService; let scheduler: SchedulerService; let metrics: MetricsService;
  let created: number[] = []; let reloaded: number[] = []; let removed: number[] = [];

  beforeEach(() => {
    created = []; reloaded = []; removed = [];
    let nextId = 5000;
    (globalThis as any).chrome = {
      tabs: {
        create: jasmine.createSpy('create').and.callFake(async (_opts: any) => {
          const id = nextId++;
          created.push(id);
          // Simulate asynchronous load completion event for the new preload
          setTimeout(() => {
            try {
              if ((globalThis as any).__onUpdatedListener) {
                (globalThis as any).__onUpdatedListener(id, { status: 'complete' }, { id } as any);
              }
            } catch {}
          }, 0);
          return { id, windowId: 1 };
        }),
        remove: jasmine.createSpy('remove').and.callFake(async (id: number) => { removed.push(id); }),
        reload: jasmine.createSpy('reload').and.callFake(async (id: number) => { reloaded.push(id); }),
        get: jasmine.createSpy('get').and.callFake(async (id: number) => ({ id, windowId: 1, active: true })),
        onUpdated: {
          addListener: (l: any) => { (globalThis as any).__onUpdatedListener = l; },
          removeListener: () => { (globalThis as any).__onUpdatedListener = undefined; }
        }
      }
    };
    metrics = new MetricsService();
    tabManager = new TabManagerService(metrics);
    scheduler = new SchedulerService();
    lifecycle = new TabLifecycleService(tabManager, scheduler, metrics);
  });

  it('creates a preload tab instead of reloading primary', async () => {
    // Primary tab already exists
    const page: PageConfig = { url: 'file:///C:/dashboards/heavy.html', delaySeconds: 5, reloadIntervalSeconds: 60 } as any;
    const cfg = new TabConfig({ page, active: true });
    cfg.tabId = 501; cfg.tabIdReady = true;
    const tabsConfig = new TabsConfig(); tabsConfig.tabs.push(cfg);

    const originalPrimary = cfg.tabId;
    await lifecycle.handleReloadAlarm(501, tabsConfig, async () => {}, async () => {}, async () => {}, { reuseLocalFileTabs: false });

    // Assertions: preload path taken (tab creation), promotion occurred (primary changed), NOT an in-place reload.
    expect(created.length).toBe(1, 'expected a preload tab creation');
    expect(reloaded).not.toContain(originalPrimary, 'should not reload original primary when preloading');
    expect(cfg.tabId).not.toBe(originalPrimary, 'primary should be replaced by promoted preload');
    expect(cfg.nextTabId).toBe(0, 'after successful promotion nextTabId reset to 0');
    expect(cfg.tabIdReady).toBeTrue();
  });
});
