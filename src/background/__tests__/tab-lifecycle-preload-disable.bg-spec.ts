// <reference types="jasmine" />
import { TabLifecycleService } from '../tab-lifecycle.service';
import { TabManagerService } from '../tab-manager.service';
import { SchedulerService } from '../scheduler.service';
import { MetricsService } from '../metrics.service';
import { TabConfig, TabsConfig, PageConfig } from '../../app/models';

/**
 * Verifies that after repeated no-event preload failures the service disables further preload attempts.
 */
describe('TabLifecycleService preload disable after repeated failures', () => {
  let lifecycle: TabLifecycleService; let tabManager: TabManagerService; let scheduler: SchedulerService; let metrics: MetricsService;
  let created: number[] = []; let removed: number[] = []; let reloaded: number[] = [];

  beforeEach(() => {
    created = []; removed = []; reloaded = [];
    (globalThis as any).chrome = {
      tabs: {
        create: jasmine.createSpy('create').and.callFake(async (opts: any) => { const id = 3000 + created.length; created.push(id); return { id, windowId: 1, url: opts.url }; }),
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
    // Speed up: override waitForInitialLoad to resolve immediately without events
    spyOn(lifecycle as any, 'waitForInitialLoad').and.callFake(async (cfg: TabConfig) => { cfg.lastPreloadWaitMs = 5; cfg.lastPreloadWaitOutcome = 'timeout'; });
  });

  it('disables further preloads after threshold of no-event failures', async () => {
    const page: PageConfig = { url: 'https://disable.test', delaySeconds: 1 } as any;
    const cfg = new TabConfig({ page, active: true });
    cfg.tabId = 800; cfg.tabIdReady = true;
    const tabsConfig = new TabsConfig(); tabsConfig.tabs.push(cfg);
    const threshold = (TabLifecycleService as any).PRELOAD_DISABLE_THRESHOLD || 5;

    for (let i = 0; i < threshold; i++) {
      await lifecycle.handleReloadAlarm(800, tabsConfig, async () => {}, async () => {}, async () => {});
      // Allow next attempt by clearing backoff
      cfg.nextPreloadAllowedAt = undefined;
    }

    expect(cfg.preloadDisabled).toBeTrue();
    expect(cfg.preloadDisabledReason).toBe('no-events-threshold');
  });
});
