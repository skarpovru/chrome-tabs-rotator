// <reference types="jasmine" />
import { TabManagerService } from '../tab-manager.service';
import { TabConfig, TabsConfig } from '../../app/models';

/**
 * Tests scenario: primary tab alive but preload reference lost => invariant enforcement
 * should not recreate phantom tabs and should clean lost references.
 */

describe('TabManagerService invariant partial loss', () => {
  let svc: TabManagerService;
  let created: any[] = [];
  beforeEach(() => {
    created = [];
    (globalThis as any).chrome = {
      tabs: {
        create: jasmine.createSpy('create').and.callFake((opts, cb) => { const tab = { id: Math.floor(Math.random()*10000), url: opts.url }; created.push(tab); cb && cb(tab); }),
        get: jasmine.createSpy('get').and.callFake((id, cb) => { if (id === 999) { (chrome as any).runtime.lastError = { message: 'not found' }; cb && cb(undefined); } else { (chrome as any).runtime.lastError = null; cb && cb({ id, url: 'https://example.com' }); } }),
        remove: jasmine.createSpy('remove')
      },
      runtime: { lastError: null }
    };
    svc = new TabManagerService();
    // simulate tabsConfig with one page where primary exists (id 100) and preload missing (stale 999)
    const tc = new TabsConfig();
    const tabCfg = new TabConfig({ page: { url: 'https://example.com' } as any, active: true });
    tabCfg.tabId = 100;
    tabCfg.tabIdReady = true;
  // No preload currently tracked in config; stale ID 999 will appear only in trackedIds list
  tabCfg.nextTabId = 0;
  tabCfg.nextTabIdReady = false;
    (svc as any).tabsConfig = tc;
    tc.tabs.push(tabCfg);
    (svc as any).ownedTabIds = new Set<number>([100, 999]);
  });

  it('clears stale preload id without creating extra tabs', async () => {
  const result = await (svc as any).enforceInvariant({ trackedIds: [100, 999] });
    expect(created.length).toBe(0); // no new tabs created
    // Expect only the primary (100) retained since preload 999 not allowed
    expect(result).toContain(100);
    expect(result).not.toContain(999);
  });
});
