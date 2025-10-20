import { RotationWatchdogService } from '../rotation-watchdog.service';
import { HealthMonitorService } from '../health-monitor.service';
import { SchedulerService } from '../scheduler.service';
import { RotationService } from '../rotation.service';
import { TabsConfig, TabConfig, ConfigData } from '../../app/models';

// Minimal chrome API stubs for unit test environment
declare const global: any;
const g: any = global as any;
g.chrome = g.chrome || {};
g.chrome.alarms = g.chrome.alarms || {
  get: async (_name: string) => null,
  clear: async (_name: string) => true,
  create: (_name: string, _info: any) => {},
};
g.chrome.tabs = g.chrome.tabs || {
  query: async () => [],
  remove: async (_ids: number[]) => {},
  create: async (opts: any) => ({ id: Math.floor(Math.random()*10000)+1, url: opts.url, active: opts.active, windowId: 1 }),
  get: async (id: number) => ({ id, url: 'https://example.test/'+id, active: false, windowId: 1 }),
  update: async (_id: number, _info: any) => {},
};

describe('RotationWatchdogService ordering preservation', () => {
  it('does not reorder pages after overdue self-heal', async () => {
  // Ensure alarms stub present for self-heal path
  g.chrome.alarms = g.chrome.alarms || { get: async () => null, clear: async () => true, create: () => {} };
  const health = new HealthMonitorService();
    const scheduler = new SchedulerService();
    const watchdog = new RotationWatchdogService(health, scheduler, { intervalSeconds: 60, graceSeconds: 5 });

    // Build RotationService with minimal dependencies (use default constructor path)
    const rotator = (global as any).rotationService || new RotationService({} as any, {} as any, { } as any);
    // Inject a fake tabsConfig with deterministic ordering
    const config: ConfigData = { pages: [
      { url: 'https://a.test', delaySeconds: 1 },
      { url: 'https://b.test', delaySeconds: 1 },
      { url: 'https://c.test', delaySeconds: 1 },
    ] } as any;
    const tabsConfig = new TabsConfig();
    for (let i=0;i<config.pages.length;i++) {
      tabsConfig.tabs.push(new TabConfig({ page: config.pages[i], active: i===0, tabIdReady: true, tabId: i+101 } as any));
    }
  ;(rotator as any).tabsConfig = tabsConfig;
  ;(rotator as any).rotationState = { isRotating: true, tabIds: tabsConfig.tabs.map(t=>t.tabId) };
  ;(rotator as any).currentIndex = 0;
  // Provide minimal no-op implementations to avoid deep chrome usage during self-heal
  ;(rotator as any).tryRebuildTabs = async () => {};
  ;(rotator as any).enforceInvariant = async () => {};
  // Ensure ALARM_ROTATE static used by watchdog exists
  (rotator as any).constructor.ALARM_ROTATE = 'rotate';
  // Pretend we are overdue: HealthMonitorService stores timing internally; mutate via private field access for test
  const sixtyAgo = Date.now() - 60000;
  const thirtyAgo = Date.now() - 30000;
  // recordScheduled sets nextRotationDueAt; then override lastRotationAt
  try { health.recordScheduled(thirtyAgo); } catch {}
  try { (health as any).timing.lastRotationAt = sixtyAgo; } catch {}

    const beforeOrder = rotator.getOrderedPageUrls();
    await watchdog.handleAlarm(rotator);
    const afterOrder = rotator.getOrderedPageUrls();

    expect(afterOrder).toEqual(beforeOrder);
    // Additional assertions: no duplicate tab IDs in tabsConfig or rotationState
    const tabIds = (rotator as any).tabsConfig?.tabs?.map((t: any) => t.tabId).filter((id: number) => id > 0) || [];
    const dupTabIds = tabIds.filter((id: number, idx: number) => tabIds.indexOf(id) !== idx);
    expect(dupTabIds.length).toBe(0);
    const tracked = ((rotator as any).rotationState?.tabIds || []).filter((id: number) => id > 0);
    const dupTracked = tracked.filter((id: number, idx: number) => tracked.indexOf(id) !== idx);
    expect(dupTracked.length).toBe(0);
    // Preload IDs uniqueness (collect nextTabId values >0)
    const preloadIds = (rotator as any).tabsConfig?.tabs?.map((t: any) => t.nextTabId).filter((id: number) => id > 0) || [];
    const dupPreloads = preloadIds.filter((id: number, idx: number) => preloadIds.indexOf(id) !== idx);
    expect(dupPreloads.length).toBe(0);
    // Combined primary + preload uniqueness
    const combined = [...tabIds, ...preloadIds];
    const dupCombined = combined.filter((id: number, idx: number) => combined.indexOf(id) !== idx);
    expect(dupCombined.length).toBe(0);
  });
});
