import { TabConfig, TabsConfig } from '../../app/models';
import { TabLifecycleService } from '../tab-lifecycle.service';
import { TabManagerService } from '../tab-manager.service';
import { SchedulerService } from '../scheduler.service';
import { MetricsService } from '../metrics.service';
import { RotationService } from '../rotation.service';
import { ConfigService } from '../config.service';
import { ConfigValidatorService, ToolbarManagerService } from '../../app/services';
import { CustomHttpClient } from '../custom-http-client.service';
import { FocusService } from '../focus.service';
import { DiagnosticsService } from '../diagnostics.service';
import { StallGuardService } from '../stall-guard.service';
import { StorageService } from '../storage.service';

// Lightweight harness: we stub chrome APIs we touch.

// Minimal chrome stubs for the interactions used in the test
const now = Date.now();
let nextTabId = 100;
const createdTabs: any[] = [];
const removed: number[] = [];
const reloaded: number[] = [];

// Use globalThis for cross-environment compatibility
(globalThis as any).chrome = {
  tabs: {
    create: async (opts: any) => {
      const id = ++nextTabId;
      const tab = { id, windowId: 1, url: opts.url, active: !!opts.active };
      createdTabs.push(tab);
      // Simulate immediate onCompleted
      setTimeout(() => {
        try { (chrome.webNavigation.onCompleted as any)._fire?.({ tabId: id, url: opts.url }); } catch {}
      }, 0);
      return tab;
    },
    update: async (id: number, opts: any) => {
      const tab = createdTabs.find(t => t.id === id);
      if (tab) tab.active = !!opts.active;
      return tab;
    },
    remove: async (ids: number[]) => { ids.forEach(id => removed.push(id)); },
    get: async (id: number) => {
      const t = createdTabs.find(t => t.id === id);
      if (!t) throw new Error('No tab');
      return t;
    },
    query: async () => createdTabs.filter(t => t.active),
    onRemoved: { addListener: () => {} },
    onUpdated: { addListener: () => {} },
  },
  webNavigation: {
  onCompleted: { addListener(fn: any) { (this as any)._fire = fn; } },
    onErrorOccurred: { addListener: () => {} },
  },
  alarms: { clear: async () => {}, clearAll: async () => {}, create: () => {}, onAlarm: { addListener: () => {} } },
  action: { setBadgeText: () => {} },
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
  runtime: { getPlatformInfo: (cb: any) => cb && cb() },
};

// Simple storage shim aligning with StorageService usage
class MemStorage extends StorageService {
  private data: Record<string, any> = {};
  override async get<T>(key: string): Promise<T | undefined> { return this.data[key]; }
  override async set(obj: Record<string, any>): Promise<void> { Object.assign(this.data, obj); }
  override async remove(key: string): Promise<void> { delete this.data[key]; }
}

// The test
describe('promotion no extra tab spawning', () => {
  it('should not create an extra tab within suppression window after promotion', async () => {
    const storage = new MemStorage();
    const rotation = new RotationService(
      new CustomHttpClient(),
      new ConfigValidatorService(),
      new ToolbarManagerService(),
      new ConfigService(new CustomHttpClient(), new ConfigValidatorService()),
      undefined,
      new FocusService(),
      new TabManagerService(new MetricsService()),
      new DiagnosticsService(),
      new StallGuardService(),
      new SchedulerService(),
      storage,
      new MetricsService()
    );
    // Enable debug for visibility if needed
    (rotation as any).debugActivationLogging = true;

    // Manually seed a single page config state resembling after initial preload creation
    const cfg = new TabConfig({ page: { url: 'https://example.test', delaySeconds: 5, reloadIntervalSeconds: 0 } as any });
    // Create primary
    await (rotation as any).tabManager.createTab(cfg, async () => {});
    // Preload (next)
    await (rotation as any).tabLifecycle?.preloadNextPageTab?.(cfg);

    const initialTabCount = createdTabs.length; // primary + preload = 2

    // Promote (simulate rotation switching to next)
    await (rotation as any).openNextPageTab(cfg);

    const afterPromotionCount = createdTabs.length;
    expect(afterPromotionCount).toBe(initialTabCount); // no creation during promotion

    // Immediately run warmPreloads (suppression window active)
    await (rotation as any).warmPreloads();

    const afterWarmCount = createdTabs.length;
    expect(afterWarmCount).toBe(afterPromotionCount); // still no new tab due to suppression
  });
});
