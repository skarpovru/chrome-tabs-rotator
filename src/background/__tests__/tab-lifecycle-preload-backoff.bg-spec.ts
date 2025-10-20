// <reference types="jasmine" />
import { TabLifecycleService } from '../tab-lifecycle.service';
import { TabManagerService } from '../tab-manager.service';
import { SchedulerService } from '../scheduler.service';
import { MetricsService } from '../metrics.service';
import { TabConfig, TabsConfig, PageConfig } from '../../app/models';

describe('TabLifecycleService preload backoff', () => {
  let lifecycle: TabLifecycleService; let tabManager: TabManagerService; let scheduler: SchedulerService; let metrics: MetricsService;
  let created: number[] = []; let removed: number[] = []; let reloaded: number[] = [];

  beforeEach(() => {
    created = []; removed = []; reloaded = [];
    (globalThis as any).chrome = {
      tabs: {
        create: jasmine.createSpy('create').and.callFake(async (opts: any) => { const id = 900 + created.length; created.push(id); return { id, windowId: 1, url: opts.url }; }),
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

  it('skips creating preload when backoff active', async () => {
    const page: PageConfig = { url: 'https://backoff.skip', delaySeconds: 1 } as any;
    const cfg = new TabConfig({ page, active: true });
    cfg.tabId = 611; cfg.tabIdReady = true;
    // Set backoff window into future
    cfg.nextPreloadAllowedAt = Date.now() + 5000;
    const tabsConfig = new TabsConfig(); tabsConfig.tabs.push(cfg);

    await lifecycle.handleReloadAlarm(611, tabsConfig, async () => {}, async () => {}, async () => {});

    // No preload created; primary reloaded
    expect(created.length).toBe(0);
    expect(reloaded).toContain(611);
  });

  it('applies exponential backoff after failed preload (never ready)', async () => {
    const page: PageConfig = { url: 'https://backoff.grow', delaySeconds: 1 } as any;
    const cfg = new TabConfig({ page, active: true });
    cfg.tabId = 700; cfg.tabIdReady = true;
    const tabsConfig = new TabsConfig(); tabsConfig.tabs.push(cfg);

    // First alarm: create preload, discard, set backoff
    await lifecycle.handleReloadAlarm(700, tabsConfig, async () => {}, async () => {}, async () => {});
    const firstBackoff = cfg.currentPreloadBackoffMs;
    expect(firstBackoff).toBeGreaterThan(0);
  const firstFailureCount = cfg.preloadFailureCount ?? 0;

    // Force time passage by clearing nextPreloadAllowedAt so second attempt allowed
    cfg.nextPreloadAllowedAt = undefined;

    // Second alarm: attempt again, discard again, backoff doubles (up to cap)
    await lifecycle.handleReloadAlarm(700, tabsConfig, async () => {}, async () => {}, async () => {});
  expect(cfg.preloadFailureCount).toBe(firstFailureCount + 1);
    expect(cfg.currentPreloadBackoffMs).toBeGreaterThanOrEqual(firstBackoff!);
  });
});
