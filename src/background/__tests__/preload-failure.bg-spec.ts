import { createRotationServiceHarness, installChromeWithStorage } from './test-helpers/rotation-service-harness';
import { RotationService } from '../rotation.service';
import { TabConfig } from '../../app/models';

/**
 * Verifies failed preload after a reload alarm keeps old primary and removes failed preload tab.
 */
describe('preload failure after reload alarm', () => {
  it('keeps old primary and discards failed preload', async () => {
    // Custom chrome mock: preload creation returns a tab but we will not trigger load completion.
    const created: any[] = [];
    installChromeWithStorage({
      tabs: {
        create: async (opts: any) => { const tab = { id: Math.floor(Math.random()*1000)+500, windowId:1, active: !!opts.active, url: opts.url }; created.push(tab); return tab; },
        get: async (id:number) => created.find(t=>t.id===id) || { id, windowId:1 },
        update: async (id:number,_opts:any) => created.find(t=>t.id===id) || { id, windowId:1 },
        query: async () => created,
        remove: async (ids:number|number[]) => { const arr = Array.isArray(ids)? ids:[ids]; for (const i of arr) { const idx = created.findIndex(t=>t.id===i); if (idx>=0) created.splice(idx,1); } }
      }
    });
    const pages = [ { url: 'https://preload-failure.example', delaySeconds: 1, reloadIntervalSeconds: 1 } ];
    const { service } = createRotationServiceHarness({ config: { pages } });
    await service.initialize();
    const cfg = (service as any).tabsConfig.tabs[0] as TabConfig;
    const originalPrimary = cfg.tabId;
    // Override waitForInitialLoad to simulate failure (timeout path without readiness)
    (service as any).tabLifecycle.waitForInitialLoad = async (_t: TabConfig, _ms: number) => { /* do nothing => not ready */ };
    await (service as any).onReloadAlarm(cfg.tabId);
    // Expect primary unchanged and nextTabId cleared back to 0
    expect(cfg.tabId).toBe(originalPrimary);
    expect(cfg.nextTabId).toBe(0);
  });
});
