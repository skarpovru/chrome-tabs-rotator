// <reference types="jasmine" />
import { TabManagerService } from '../tab-manager.service';
import { MetricsService } from '../metrics.service';
import { TabConfig, TabsConfig } from '../../app/models';

describe('TabManagerService duplicate pruning', () => {
  let tm: TabManagerService;

  beforeEach(() => {
    (globalThis as any).chrome = {
      tabs: {
        get: jasmine.createSpy('get').and.callFake(async (id:number)=> ({ id, windowId: 1 })),
        remove: jasmine.createSpy('remove').and.resolveTo(),
        create: jasmine.createSpy('create').and.callFake(async ({ url, active }: any) => ({ id: 800 + Math.floor(Math.random()*100), url, active, windowId: 1 }))
      }
    };
    tm = new TabManagerService(new MetricsService());
  });

  it('removes extra owned duplicate ids beyond per-page cap', async () => {
    const cfg = new TabsConfig();
    const page: any = { url: 'https://dup.example', delaySeconds: 5, reloadIntervalSeconds: 0 };
    const tc = new TabConfig({ page, active: true });
    // Simulate created primary + preload
    tc.tabId = 111; tc.tabIdReady = true; tc.nextTabId = 112; tc.nextTabIdReady = true;
    (tm as any).ownedTabIds.add(111); (tm as any).ownedTabIds.add(112);
    cfg.tabs.push(tc);
    tm.tabsConfig = cfg;

    // Add extra duplicate tracked IDs (owned)
    (tm as any).ownedTabIds.add(113);
    const updated = await tm.enforceInvariant({ trackedIds: [111,112,113,113], force: true });
    expect(updated).toContain(111);
    expect(updated).toContain(112);
    expect(updated).not.toContain(113);
    expect((chrome.tabs.remove as any).calls.count()).toBe(1);
  });
});
