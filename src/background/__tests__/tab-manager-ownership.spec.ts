// <reference types="jasmine" />
import { TabManagerService } from '../tab-manager.service';
import { TabConfig, TabsConfig, PageConfig } from '../../app/models';

// Minimal metric stub
class MetricsStub { recordTabCreation() {} }

describe('TabManagerService ownership & anti-spam', () => {
  let tm: TabManagerService;
  let created: number[] = [];

  beforeEach(() => {
    created = [];
    (globalThis as any).chrome = {
      tabs: {
        create: jasmine.createSpy('create').and.callFake(async (opts: any) => {
          const id = 500 + created.length;
          created.push(id);
          return { id, windowId: 1, url: opts.url };
        }),
        get: jasmine.createSpy('get').and.callFake(async (id: number) => ({ id, windowId: 1 })),
        remove: jasmine.createSpy('remove').and.callFake(async () => {}),
        query: jasmine.createSpy('query').and.resolveTo([])
      }
    };
    tm = new TabManagerService(new MetricsStub() as any);
  });

  it('does not remove non-owned (foreign) tab IDs during enforceInvariant', async () => {
    const cfg = new TabsConfig();
    const page: PageConfig = { url: 'https://example.com', delaySeconds: 5 } as any;
    const tabCfg = new TabConfig({ page, active: true });
    await tm.createTab(tabCfg, async () => {});
    cfg.tabs.push(tabCfg);
    tm.tabsConfig = cfg;

    const foreignId = 42; // not owned
    const updated = await tm.enforceInvariant({ trackedIds: [tabCfg.tabId!, foreignId], force: true });
    expect(updated).toContain(tabCfg.tabId!);
    expect(updated).not.toContain(foreignId); // foreign should be pruned from tracked list only, not removed via chrome.tabs.remove
    expect((chrome.tabs.remove as any).calls.count()).toBe(0);
  });

  it('removes only owned extras', async () => {
    const cfg = new TabsConfig();
    const p1: PageConfig = { url: 'https://a.example', delaySeconds: 5 } as any;
    const p2: PageConfig = { url: 'https://b.example', delaySeconds: 5 } as any;
    const c1 = new TabConfig({ page: p1, active: true });
    await tm.createTab(c1, async () => {});
    const c2 = new TabConfig({ page: p2, active: false });
    await tm.createTab(c2, async () => {});
    cfg.tabs.push(c1, c2);
    tm.tabsConfig = cfg;

    // Inject an owned extra artificially (simulate stale preload ID)
    const extraOwned = 999;
    (tm as any).ownedTabIds.add(extraOwned);
    (chrome.tabs.get as any).and.callFake(async (id: number) => ({ id, windowId: 1 }));

    const updated = await tm.enforceInvariant({ trackedIds: [c1.tabId!, c2.tabId!, extraOwned], force: true });
    expect(updated).toContain(c1.tabId!);
    expect(updated).toContain(c2.tabId!);
    expect(updated).not.toContain(extraOwned);
    expect((chrome.tabs.remove as any).calls.count()).toBe(1);
  });
});
