import { TabConfig, TabsConfig } from '../app/models';
import { TabManagerService } from './tab-manager.service';
import { SchedulerService } from './scheduler.service';
import { MetricsService } from './metrics.service';
import { safeRuntimeLastError } from '../shared';

export interface PreloadResult {
  updatedConfig: TabConfig;
}

/**
 * Handles low-level tab lifecycle operations: create, preload (next tab), reload alarms.
 * Keeps RotationService focused on orchestration.
 */
export class TabLifecycleService {
  constructor(
    private tabManager: TabManagerService,
    private scheduler: SchedulerService,
    private metrics: MetricsService
  ) {}

  async createPrimaryTab(tabConfig: TabConfig, onReady: (cfg: TabConfig) => Promise<void>): Promise<TabConfig> {
    const created = await this.tabManager.createTab(tabConfig, async (id: number) => {
      tabConfig.tabId = id;
      tabConfig.tabIdReady = true;
      await onReady(tabConfig);
    });
    return created;
  }

  async preloadNextPageTab(tabConfig: TabConfig, onActivatedFocus?: (tabId: number) => Promise<void>): Promise<PreloadResult> {
    try {
      if (tabConfig.nextTabId > 0) return { updatedConfig: tabConfig }; // already preloaded
      const next = await this.tabManager.createTab(tabConfig, async (id: number) => {
        tabConfig.nextTabId = id;
        tabConfig.nextTabIdReady = true;
        if (onActivatedFocus) await onActivatedFocus(id);
      });
      return { updatedConfig: next };
    } catch (e) {
      console.error('[tabLifecycle] preloadNextPageTab failed', e);
      return { updatedConfig: tabConfig };
    }
  }

  scheduleReloadAlarm(tabId: number, seconds: number) {
    if (!tabId || tabId <= 0) return;
    this.scheduler.scheduleReload(tabId, seconds);
    this.metrics.recordReloadScheduled(tabId, seconds);
  }

  clearReloadAlarmForTab(tabId?: number) {
    if (tabId && tabId > 0) this.scheduler.clearReload(tabId);
  }

  async handleReloadAlarm(tabId: number, tabsConfig: TabsConfig | undefined, createCb: (tc: TabConfig) => Promise<void>, setStateCb: (tabIds: number[]) => Promise<void>, delegateInvariant: () => Promise<void>): Promise<void> {
    const tabConfig = tabsConfig?.tabs?.find(t => t.tabId === tabId || t.nextTabId === tabId);
    if (!tabConfig) return;
    try {
      // Previous behaviour: if only primary existed we created a brand new tab on each reload alarm
      // (assigning it as primary or preload) which could lead to continual tab spawning if loads were slow.
      // New behaviour: prefer to reload whichever concrete tab currently represents the page; only create
      // a new tab if neither primary nor preload exists (both IDs missing) which is a legitimate recovery scenario.
      const targetReloadId = tabConfig.nextTabId > 0 ? tabConfig.nextTabId : tabConfig.tabId;
      if (targetReloadId > 0) {
        console.log('[tabLifecycle] Reloading tab', targetReloadId);
        await chrome.tabs.reload(targetReloadId);
      } else {
        console.log('[tabLifecycle] Recovering missing tab before reload for page', tabConfig.page?.url);
        await createCb(tabConfig);
        await setStateCb([
          ...(tabsConfig?.tabs?.flatMap(t => [t.tabId, t.nextTabId]).filter(id => id && id > 0) as number[])
        ]);
        await delegateInvariant();
      }
    } catch (error) {
      console.error('[tabLifecycle] Error in handleReloadAlarm:', error, safeRuntimeLastError());
    }
  }

  /** Wait for initial load (status=complete) of primary or next tab; resolves after success or timeout. */
  async waitForInitialLoad(tabConfig: TabConfig, timeoutMs = 8000): Promise<void> {
    return new Promise(async (resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          try { chrome.tabs.onUpdated.removeListener(listener); } catch {}
          resolve();
        }
      };
      const listener = (updatedTabId: number, changeInfo: Record<string, any>) => {
        if ((updatedTabId === tabConfig.tabId || updatedTabId === tabConfig.nextTabId) && changeInfo['status'] === 'complete') {
          if (updatedTabId === tabConfig.nextTabId) tabConfig.nextTabIdReady = true; else tabConfig.tabIdReady = true;
          if (!(tabConfig as any).__initialLogged) {
            (tabConfig as any).__initialLogged = true;
            console.log('[tabLifecycle] Initial load complete', { tabId: updatedTabId });
          }
          done();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      try {
        const id = tabConfig.nextTabId > 0 ? tabConfig.nextTabId : tabConfig.tabId;
        if (id) {
          await chrome.tabs.get(id);
          setTimeout(done, 250);
        }
      } catch {}
      setTimeout(done, timeoutMs);
    });
  }
}
