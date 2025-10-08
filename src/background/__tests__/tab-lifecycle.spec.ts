// <reference types="jasmine" />
import { TabLifecycleService } from '../tab-lifecycle.service';
import { TabManagerService } from '../tab-manager.service';
import { SchedulerService } from '../scheduler.service';
import { MetricsService } from '../metrics.service';
import { TabConfig, TabsConfig, PageConfig } from '../../app/models';

describe('TabLifecycleService reload alarm', () => {
  let tabManager: TabManagerService;
  let lifecycle: TabLifecycleService;
  let scheduler: SchedulerService;
  let metrics: MetricsService;
  const createdTabs: number[] = [];

  beforeEach(() => {
    // minimal chrome mock
  (globalThis as any).chrome = {
      tabs: {
        reload: jasmine.createSpy('reload'),
        create: jasmine.createSpy('create').and.callFake(async (opts: any) => {
          const id = createdTabs.length + 100;
            createdTabs.push(id);
            return { id, windowId: 1, url: opts.url };
        }),
        get: jasmine.createSpy('get').and.callFake(async (id: number) => ({ id, windowId: 1 })),
        onUpdated: { addListener: () => {}, removeListener: () => {} }
      }
    };
    scheduler = new SchedulerService();
    metrics = new MetricsService();
    tabManager = new TabManagerService(metrics);
    lifecycle = new TabLifecycleService(tabManager, scheduler, metrics);
  });

  it('reloads existing primary tab instead of creating new one', async () => {
    const page: PageConfig = { url: 'https://example.com', delaySeconds: 1 } as any;
    const cfg = new TabConfig({ page, active: true });
    cfg.tabId = 123; cfg.tabIdReady = true;
    const tabsConfig = new TabsConfig();
    tabsConfig.tabs.push(cfg);

    await lifecycle.handleReloadAlarm(123, tabsConfig, async () => { /* should not be called */ }, async () => {}, async () => {});

  expect((chrome.tabs.reload as any).calls.count()).toBe(1);
  });

  it('creates tab if missing both primary and next IDs', async () => {
    const page: PageConfig = { url: 'https://example.net', delaySeconds: 1 } as any;
    const cfg = new TabConfig({ page, active: true });
    const tabsConfig = new TabsConfig();
    tabsConfig.tabs.push(cfg);
    let stateIds: number[] = [];

    await lifecycle.handleReloadAlarm(0, tabsConfig, async (tc) => {
      await tabManager.createTab(tc, async (id: number) => { tc.tabId = id; tc.tabIdReady = true; });
    }, async ids => { stateIds = ids; }, async () => {});

    expect(createdTabs.length).toBe(1);
    expect(stateIds.includes(createdTabs[0])).toBeTrue();
  });
});
