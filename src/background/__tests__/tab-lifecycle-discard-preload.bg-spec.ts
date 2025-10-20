// <reference types="jasmine" />
import { TabLifecycleService } from '../tab-lifecycle.service';
import { TabManagerService } from '../tab-manager.service';
import { SchedulerService } from '../scheduler.service';
import { MetricsService } from '../metrics.service';
import { TabConfig, TabsConfig, PageConfig } from '../../app/models';

// Tests the behavior where a preload is created but never becomes ready; reload alarm should discard it.

describe('TabLifecycleService reload alarm preload discard', () => {
  let lifecycle: TabLifecycleService; let tabManager: TabManagerService; let scheduler: SchedulerService; let metrics: MetricsService;
  let createdTabs: number[] = []; let removedTabs: number[] = []; let reloadedTabs: number[] = [];

  beforeEach(() => {
    createdTabs = []; removedTabs = []; reloadedTabs = [];
    (globalThis as any).chrome = {
      tabs: {
        create: jasmine.createSpy('create').and.callFake(async (opts: any) => { const id = 800 + createdTabs.length; createdTabs.push(id); return { id, windowId: 1, url: opts.url }; }),
        remove: jasmine.createSpy('remove').and.callFake(async (id: number) => { removedTabs.push(id); }),
        reload: jasmine.createSpy('reload').and.callFake(async (id: number) => { reloadedTabs.push(id); }),
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

  it('discards unready preload and reloads primary', async () => {
    const page: PageConfig = { url: 'https://discard.test', delaySeconds: 1 } as any;
    const cfg = new TabConfig({ page, active: true });
    cfg.tabId = 501; cfg.tabIdReady = true; // existing healthy primary
    const tabsConfig = new TabsConfig(); tabsConfig.tabs.push(cfg);

    // Simulate reload alarm targeting primary; preload will be created but never marked ready
    await lifecycle.handleReloadAlarm(501, tabsConfig, async () => {}, async () => {}, async () => {});

    // After handling: a preload would have been created (id=800), waited, then discarded since nextTabIdReady=false
    expect(createdTabs.length).toBe(1); // preload creation attempted
    expect(removedTabs).toContain(createdTabs[0]); // preload removed
    expect(cfg.nextTabId).toBe(0); // cleared
    expect(reloadedTabs).toContain(501); // primary reloaded as fallback
  });
});
