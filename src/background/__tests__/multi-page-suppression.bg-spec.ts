import { TabConfig } from '../../app/models';
import { RotationService } from '../rotation.service';
import { ConfigValidatorService, ToolbarManagerService } from '../../app/services';
import { CustomHttpClient } from '../custom-http-client.service';
import { ConfigService } from '../config.service';
import { FocusService } from '../focus.service';
import { TabManagerService } from '../tab-manager.service';
import { DiagnosticsService } from '../diagnostics.service';
import { StallGuardService } from '../stall-guard.service';
import { SchedulerService } from '../scheduler.service';
import { StorageService } from '../storage.service';
import { MetricsService } from '../metrics.service';

// Chrome stubs (minimal for preload/warmPreloads testing)
let nextId = 300;
const tabs: any[] = [];
(globalThis as any).chrome = {
  tabs: {
    create: async (opts: any) => {
      const id = ++nextId;
      const tab = { id, windowId: 1, url: opts.url, active: !!opts.active };
      tabs.push(tab);
      // Debug instrumentation to diagnose undefined tab issue in warmPreloads test
      try { console.log('[multi-page-spec] stub create returning', JSON.stringify(tab)); } catch {}
      setTimeout(() => { try { (chrome.webNavigation.onCompleted as any)._fire?.({ tabId: id, url: opts.url }); } catch {} }, 0);
      return tab;
    },
    update: async (id: number, opts: any) => { const t = tabs.find(t => t.id === id); if (t) t.active = !!opts.active; return t; },
    get: async (id: number) => { const t = tabs.find(t => t.id === id); if (!t) throw new Error('No tab'); return t; },
    remove: async (ids: number[]) => { /* noop */ },
    query: async () => tabs.filter(t => t.active),
    onRemoved: { addListener: () => {} },
    onUpdated: { addListener: () => {} },
  },
  webNavigation: { onCompleted: { addListener(fn: any){ (this as any)._fire = fn; } }, onErrorOccurred: { addListener: () => {} } },
  alarms: { clear: async () => {}, clearAll: async () => {}, create: () => {}, onAlarm: { addListener: () => {} } },
  action: { setBadgeText: () => {} },
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
  runtime: { getPlatformInfo: (cb: any) => cb && cb() },
};

class MemStorage extends StorageService { private data: Record<string, any> = {}; override async get<T>(k: string){ return this.data[k]; } override async set(o: Record<string, any>){ Object.assign(this.data,o);} override async remove(k: string){ delete this.data[k]; } }

// No-op startup recovery to prevent background constructor from auto-creating tabs
class NoopStartupRecovery { restore(){ return Promise.resolve({}); } }

describe('multi-page warm preload suppression', () => {
  it('recreates preload for non-promoted page while suppressing recently promoted page', async () => {
    const rotation = new RotationService(
      new CustomHttpClient(),
      new ConfigValidatorService(),
      new ToolbarManagerService(),
      new ConfigService(new CustomHttpClient(), new ConfigValidatorService()),
      new NoopStartupRecovery() as any,
      new FocusService(),
      new TabManagerService(new MetricsService()),
      new DiagnosticsService(),
      new StallGuardService(),
      new SchedulerService(),
      new MemStorage(),
      new MetricsService()
    );
    // Allow any pending constructor microtasks to settle
    await new Promise(r=>setTimeout(r,0));
  // Use positive reloadIntervalSeconds so warmPreloads will attempt creation (new gating logic)
  const pageA = new TabConfig({ page: { url: 'https://a.test', delaySeconds: 5, reloadIntervalSeconds: 60 } as any });
  const pageB = new TabConfig({ page: { url: 'https://b.test', delaySeconds: 5, reloadIntervalSeconds: 60 } as any });
      const tm = (rotation as any).tabManager;
      tm.tabsConfig.tabs = [];
      for (const p of [pageA, pageB]) {
        p.tabId = ++nextId;
        p.tabIdReady = true;
        p.active = p === pageA; // A active
        tabs.push({ id: p.tabId, windowId: 1, url: p.page.url, active: p.active });
        tm.tabsConfig.tabs.push(p);
      }
      (rotation as any)._tabsConfig = tm.tabsConfig;
      (rotation as any).rotationState.isRotating = true;
      (rotation as any).rotationState.tabIds = tm.tabsConfig.tabs.map((t: any) => t.tabId);
  ;(rotation as any).debugActivationLogging = true;
      // Monkeypatch tabLifecycle to simplify preload creation without touching primaries
      (rotation as any).tabLifecycle.preloadNextPageTab = async (tabCfg: any) => {
        if (tabCfg.nextTabId > 0) return { updatedConfig: tabCfg };
        const id = ++nextId;
        tabCfg.nextTabId = id; tabCfg.nextTabIdReady = true;
        tabs.push({ id, windowId: 1, url: tabCfg.page.url, active: false });
        return { updatedConfig: tabCfg };
      };

      // Preload each (simulate existing warm state)
      for (const p of [pageA, pageB]) {
        p.nextTabId = ++nextId; p.nextTabIdReady = true;
        tabs.push({ id: p.nextTabId, windowId: 1, url: p.page.url, active: false });
      }
      (rotation as any).rotationState.tabIds = tm.tabsConfig.tabs.flatMap((t: any)=>[t.tabId, t.nextTabId]);

      // Simulate promotion of pageB: its preload became primary and we cleared its preload slot.
      pageB.lastPromotionAt = Date.now();
  // const oldBPreload = pageB.nextTabId; // keep for id bookkeeping (unused)
      pageB.nextTabId = 0; pageB.nextTabIdReady = false;
      // Also clear pageA's preload to ensure warmPreloads will recreate ONLY A (since B suppressed)
  // const oldAPreload = pageA.nextTabId; // unused
      pageA.nextTabId = 0; pageA.nextTabIdReady = false;

      const knownIds = new Set(tabs.map(t => t.id));
      // Debug: capture initial state
      // console.log('[multi-page-spec] pre-warm state', tm.tabsConfig.tabs.map((p:any)=>({url:p.page.url, tabId:p.tabId, next:p.nextTabId, lastPromotionAt:p.lastPromotionAt})));
      await (rotation as any).warmPreloads();
  // console.log('[multi-page-spec] post-first-warm', tm.tabsConfig.tabs.map((p:any)=>({url:p.page.url, next:p.nextTabId})));
      const newIds = tabs.filter(t => !knownIds.has(t.id)).map(t => t.id);

      expect(pageA.nextTabId).withContext('Page A should get a new preload').toBeGreaterThan(0);
      expect(pageB.nextTabId).withContext('Page B suppressed should not get a new preload yet').toBe(0);
      expect(newIds.length).withContext('Exactly one new preload tab created').toBe(1);

      // After suppression window passes, warmPreloads should now create pageB preload
      await new Promise(r => setTimeout(r, 3100)); // > SUPPRESSION_MS (3000)
      const beforeLate = new Set(tabs.map(t => t.id));
      await (rotation as any).warmPreloads();
  // console.log('[multi-page-spec] post-second-warm', tm.tabsConfig.tabs.map((p:any)=>({url:p.page.url, next:p.nextTabId})));
      expect(pageB.nextTabId).withContext('Page B should eventually get a preload after suppression window').toBeGreaterThan(0);
      const lateNew = tabs.filter(t => !beforeLate.has(t.id)).map(t => t.id);
      expect(lateNew.length).withContext('One new preload after suppression window').toBe(1);

    // Final sanity: only expected number of total tabs exist (2 primaries + A preload + B preload eventually)
    expect(tabs.filter(t=>t.url === pageA.page.url).length).toBeGreaterThanOrEqual(2);
    expect(tabs.filter(t=>t.url === pageB.page.url).length).toBeGreaterThanOrEqual(2);
  });
});
