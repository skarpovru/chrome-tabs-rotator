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

  async createPrimaryTab(
    tabConfig: TabConfig,
    onReady: (cfg: TabConfig) => Promise<void>
  ): Promise<TabConfig> {
    const created = await this.tabManager.createTab(
      tabConfig,
      async (id: number) => {
        tabConfig.tabId = id;
        tabConfig.tabIdReady = true;
        await onReady(tabConfig);
      }
    );
    return created;
  }

  async preloadNextPageTab(
    tabConfig: TabConfig,
    onActivatedFocus?: (tabId: number) => Promise<void>
  ): Promise<PreloadResult> {
    try {
      if (tabConfig.nextTabId > 0) return { updatedConfig: tabConfig }; // already preloaded
      const next = await this.tabManager.createTab(
        tabConfig,
        async (id: number) => {
          tabConfig.nextTabId = id;
          // Do NOT mark nextTabIdReady here; readiness should reflect actual load completion.
          tabConfig.nextTabIdReady = false;
          tabConfig.preloadCreationAt = Date.now();
          tabConfig.preloadOnUpdatedCount = 0;
          tabConfig.preloadCompleteObserved = false;
          tabConfig.lastPreloadWaitOutcome = undefined;
          if (onActivatedFocus) await onActivatedFocus(id);
        }
      );
      return { updatedConfig: next };
    } catch (e) {
      console.error('[tabLifecycle] preloadNextPageTab failed', e);
      return { updatedConfig: tabConfig };
    }
  }

  scheduleReloadAlarm(tabId: number, seconds: number) {
    if (!tabId || tabId <= 0) return;
    void this.scheduler.scheduleReload(tabId, seconds);
    this.metrics.recordReloadScheduled(tabId, seconds);
  }

  clearReloadAlarmForTab(tabId?: number) {
    if (tabId && tabId > 0) void this.scheduler.clearReload(tabId);
  }

  async handleReloadAlarm(
    tabId: number,
    tabsConfig: TabsConfig | undefined,
    createCb: (tc: TabConfig) => Promise<void>,
    setStateCb: (tabIds: number[]) => Promise<void>,
    delegateInvariant: () => Promise<void>
  ): Promise<void> {
    const tabConfig = tabsConfig?.tabs?.find(
      (t) => t.tabId === tabId || t.nextTabId === tabId
    );
    if (!tabConfig) return;
    try {
      // Simplified strategy:
      // 1. Always create a hidden preload (if one does not exist) for freshness instead of reloading primary directly.
      // 2. Wait briefly for its initial load completion (non-blocking timeout safety inside waitForInitialLoad).
      // 3. Promote preload to primary (swap) and remove old primary.
      // 4. If we fail to create or load the preload, fallback to reloading existing primary.
      const hadPrimary = tabConfig.tabId > 0;
      const existingPreloadId =
        tabConfig.nextTabId > 0 ? tabConfig.nextTabId : 0;
      const now = Date.now();
      const backoffActive = (tabConfig.nextPreloadAllowedAt ?? 0) > now;
      let createdPreload = false;
      if (!existingPreloadId && !backoffActive) {
        // Create preload
        const beforeIds = new Set<number>(
          tabsConfig?.tabs
            ?.flatMap((t) => [t.tabId, t.nextTabId])
            .filter((id) => id && id > 0) as number[]
        );
        const preloadRes = await this.tabManager.createTab(
          tabConfig,
          async (id: number) => {
            tabConfig.nextTabId = id;
            tabConfig.nextTabIdReady = false; // wait for load event
            // Telemetry init for reload-alarm driven preloads
            tabConfig.preloadCreationAt = Date.now();
            tabConfig.preloadOnUpdatedCount = 0;
            tabConfig.preloadCompleteObserved = false;
            tabConfig.lastPreloadWaitOutcome = undefined;
            tabConfig.preloadStatusesSeen = [];
          }
        );
        // createTab returns TabConfig; tabConfig.nextTabId now holds new preload id if creation succeeded
        createdPreload = tabConfig.nextTabId > 0;
        if (createdPreload) {
          // Persist new id list if not already present
          const afterIds = new Set<number>(
            tabsConfig?.tabs
              ?.flatMap((t) => [t.tabId, t.nextTabId])
              .filter((id) => id && id > 0) as number[]
          );
          if (afterIds.size !== beforeIds.size) {
            await setStateCb([...afterIds]);
          }
        } else {
          // If we did NOT create a preload because createTab assigned a primary (missing both IDs scenario)
          if (tabConfig.tabId > 0 && !beforeIds.has(tabConfig.tabId)) {
            const afterPrimaryIds = new Set<number>(
              tabsConfig?.tabs
                ?.flatMap((t) => [t.tabId, t.nextTabId])
                .filter((id) => id && id > 0) as number[]
            );
            await setStateCb([...afterPrimaryIds]);
          }
        }
      }

      // If there's now a preload attempt, wait for its initial load (best-effort)
      if (tabConfig.nextTabId > 0) {
        try {
          await this.waitForInitialLoad(tabConfig, 12000);
        } catch (e) {
          console.debug('[tabLifecycle] waitForInitialLoad error', e);
        }
      }

      const readyPreload = tabConfig.nextTabId > 0 && tabConfig.nextTabIdReady;
      if (readyPreload) {
        const oldPrimary = tabConfig.tabId > 0 ? tabConfig.tabId : undefined;
        let oldPrimaryActive = false;
        if (oldPrimary) {
          try {
            const t = await chrome.tabs.get(oldPrimary);
            oldPrimaryActive = !!t?.active;
          } catch {}
        }
        // Promote
        tabConfig.tabId = tabConfig.nextTabId;
        tabConfig.tabIdReady = true;
        tabConfig.nextTabId = 0;
        tabConfig.nextTabIdReady = false;
        tabConfig.lastPromotionAt = Date.now();
        // If old primary was active, activate the new one before removing old to reduce flicker.
        if (oldPrimaryActive) {
          try {
            await chrome.tabs.update(tabConfig.tabId, { active: true });
          } catch {}
        }
        // Remove old primary if exists
        if (oldPrimary) {
          try {
            await chrome.tabs.remove(oldPrimary);
          } catch {}
        }
        // Update state
        await setStateCb([
          ...(tabsConfig?.tabs
            ?.flatMap((t) => [t.tabId, t.nextTabId])
            .filter((id) => id && id > 0) as number[]),
        ]);
        await delegateInvariant();
        console.log('[tabLifecycle] Reload alarm promoted fresh preload', {
          newPrimary: tabConfig.tabId,
          oldPrimary,
        });
        try {
          // Add history entry for successful promotion
          const hist = tabConfig.preloadHistory || [];
            const httpMap = (self as any).__httpStatusMap || {};
            const statusCode = httpMap[tabConfig.tabId]; // new primary was preload
            const errMap = (self as any).__httpErrorTextMap || {};
            const httpErrorText = errMap[tabConfig.tabId];
          hist.unshift({
            at: Date.now(),
            waitMs: tabConfig.lastPreloadWaitMs,
            outcome: tabConfig.lastPreloadWaitOutcome || 'promoted',
            onUpdatedCount: tabConfig.preloadOnUpdatedCount,
            statuses: tabConfig.preloadStatusesSeen?.slice(0, 10),
            reason: 'promoted',
            httpStatus: typeof statusCode === 'number' ? statusCode : undefined,
            httpError: httpErrorText,
            url: tabConfig.page?.url,
          });
          tabConfig.preloadHistoryMax = tabConfig.preloadHistoryMax || 5;
          tabConfig.preloadHistory = hist.slice(0, tabConfig.preloadHistoryMax);
        } catch {}
        // Reset backoff on success
        tabConfig.preloadFailureCount = 0;
        tabConfig.currentPreloadBackoffMs = 0;
        tabConfig.nextPreloadAllowedAt = undefined;
      } else {
        // Fallback: reload the existing primary if promotion not possible
        // Discard failed preload attempt if it exists (never became ready)
        if (tabConfig.nextTabId > 0 && !tabConfig.nextTabIdReady) {
          const failedPreloadId = tabConfig.nextTabId;
          tabConfig.nextTabId = 0;
          tabConfig.nextTabIdReady = false;
          try {
            await chrome.tabs.remove(failedPreloadId);
          } catch {}
          const reason = this.classifyPreloadFailure(tabConfig);
          console.warn(
            '[tabLifecycle] Discarded failed preload after reload alarm timeout',
            failedPreloadId,
            {
              reason,
              waitedMs: tabConfig.lastPreloadWaitMs,
              onUpdatedEvents: tabConfig.preloadOnUpdatedCount,
              completeObserved: tabConfig.preloadCompleteObserved,
              creationAgeMs: tabConfig.preloadCreationAt
                ? Date.now() - tabConfig.preloadCreationAt
                : undefined,
              lastOutcome: tabConfig.lastPreloadWaitOutcome,
            }
          );
          try {
            const hist = tabConfig.preloadHistory || [];
            const httpMap = (self as any).__httpStatusMap || {};
            const statusCode = httpMap[failedPreloadId];
            const errMap = (self as any).__httpErrorTextMap || {};
            const httpErrorText = errMap[failedPreloadId];
            hist.unshift({
              at: Date.now(),
              waitMs: tabConfig.lastPreloadWaitMs,
              outcome: tabConfig.lastPreloadWaitOutcome || 'discarded',
              onUpdatedCount: tabConfig.preloadOnUpdatedCount,
              statuses: tabConfig.preloadStatusesSeen?.slice(0, 10),
              reason,
              httpStatus: typeof statusCode === 'number' ? statusCode : undefined,
              httpError: httpErrorText,
              url: tabConfig.page?.url,
            });
            tabConfig.preloadHistoryMax = tabConfig.preloadHistoryMax || 5;
            tabConfig.preloadHistory = hist.slice(0, tabConfig.preloadHistoryMax);
          } catch {}
          // Update persisted IDs after removal
          await setStateCb([
            ...(tabsConfig?.tabs
              ?.flatMap((t) => [t.tabId, t.nextTabId])
              .filter((id) => id && id > 0) as number[]),
          ]);
          // Increment backoff counters
          tabConfig.preloadFailureCount =
            (tabConfig.preloadFailureCount ?? 0) + 1;
          const prevBackoff = tabConfig.currentPreloadBackoffMs ?? 0;
          const base = 2000; // 2s base
          const max = 60000; // 60s cap
          const next = prevBackoff > 0 ? Math.min(prevBackoff * 2, max) : base;
          tabConfig.currentPreloadBackoffMs = next;
          tabConfig.nextPreloadAllowedAt = Date.now() + next;
          console.info('[tabLifecycle] Preload backoff applied', {
            count: tabConfig.preloadFailureCount,
            backoffMs: next,
          });
        }
        if (tabConfig.tabId > 0) {
          console.log(
            '[tabLifecycle] Reload alarm fallback reload primary',
            tabConfig.tabId
          );
          try {
            await chrome.tabs.reload(tabConfig.tabId);
          } catch {}
        } else if (!hadPrimary) {
          // No primary exists – create one directly as ultimate recovery path.
          try {
            await createCb(tabConfig);
            await delegateInvariant();
            console.log(
              '[tabLifecycle] Recovery created primary after failed preload.'
            );
          } catch (e) {
            console.error('[tabLifecycle] Recovery create primary failed', e);
          }
        }
      }
    } catch (error) {
      console.error(
        '[tabLifecycle] Error in handleReloadAlarm:',
        error,
        safeRuntimeLastError()
      );
    }
  }

  /** Wait for initial load (status=complete) of primary or next tab; resolves after success or timeout. */
  async waitForInitialLoad(
    tabConfig: TabConfig,
    timeoutMs = 8000
  ): Promise<void> {
    return new Promise(async (resolve) => {
      let resolved = false;
      const start = Date.now();
      const done = () => {
        if (!resolved) {
          resolved = true;
          try {
            chrome.tabs.onUpdated.removeListener(listener);
          } catch {}
          tabConfig.lastPreloadWaitMs = Date.now() - start;
          resolve();
        }
      };
      const listener = (
        updatedTabId: number,
        changeInfo: Record<string, any>,
        _tab: chrome.tabs.Tab
      ) => {
        const isTracked =
          updatedTabId === tabConfig.tabId ||
          updatedTabId === tabConfig.nextTabId;
        if (isTracked) {
          // Record status transitions for preload tab only.
          if (updatedTabId === tabConfig.nextTabId) {
            // Increment onUpdated count for every tracked preload update.
            tabConfig.preloadOnUpdatedCount =
              (tabConfig.preloadOnUpdatedCount ?? 0) + 1;
            const statusStr = changeInfo['status']
              ? String(changeInfo['status'])
              : 'unknown';
            tabConfig.preloadStatusesSeen =
              tabConfig.preloadStatusesSeen || [];
            if (
              !tabConfig.preloadStatusesSeen.length ||
              tabConfig.preloadStatusesSeen[
                tabConfig.preloadStatusesSeen.length - 1
              ] !== statusStr
            ) {
              tabConfig.preloadStatusesSeen.push(statusStr);
            }
          }
          if (changeInfo['status'] === 'complete') {
            if (updatedTabId === tabConfig.nextTabId)
              tabConfig.nextTabIdReady = true;
            else tabConfig.tabIdReady = true;
            if (!(tabConfig as any).__initialLogged) {
              (tabConfig as any).__initialLogged = true;
              console.log('[tabLifecycle] Initial load complete', {
                tabId: updatedTabId,
              });
            }
            if (updatedTabId === tabConfig.nextTabId)
              tabConfig.preloadCompleteObserved = true;
            tabConfig.lastPreloadWaitOutcome = 'complete';
            if (updatedTabId === tabConfig.tabId) {
              tabConfig.primaryInitialWaitMs = Date.now() - start;
              tabConfig.primaryInitialWaitOutcome = 'complete';
            }
            done();
          }
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      try {
        const id =
          tabConfig.nextTabId > 0 ? tabConfig.nextTabId : tabConfig.tabId;
        if (id) {
          await chrome.tabs.get(id);
          setTimeout(done, 250);
        }
      } catch {}
      setTimeout(() => {
        if (!resolved) {
          tabConfig.lastPreloadWaitOutcome =
            tabConfig.lastPreloadWaitOutcome || 'timeout';
          if (tabConfig.tabId > 0 && !((tabConfig.primaryInitialWaitMs ?? 0) > 0)) {
            tabConfig.primaryInitialWaitMs = Date.now() - start;
            tabConfig.primaryInitialWaitOutcome = 'timeout';
          }
        }
        done();
      }, timeoutMs);
    });
  }

  /** Classify why a preload failed to become ready for promotion. */
  private classifyPreloadFailure(tabConfig: TabConfig): string {
    // If creation timestamp missing we can still derive limited classifications.
    if (!tabConfig.preloadCreationAt) {
      if (tabConfig.preloadOnUpdatedCount && tabConfig.preloadCompleteObserved)
        return 'complete-no-timestamp';
      if ((tabConfig.preloadOnUpdatedCount ?? 0) === 0)
        return 'no-events-no-timestamp';
      return 'unknown';
    }
    const age = Date.now() - tabConfig.preloadCreationAt;
    if ((tabConfig.preloadOnUpdatedCount ?? 0) === 0)
      return 'no-onUpdated-events';
    if (tabConfig.lastPreloadWaitOutcome === 'timeout') return 'load-timeout';
    if (tabConfig.lastPreloadWaitOutcome === 'error') return 'load-error';
    if (tabConfig.preloadCompleteObserved) return 'ready-but-not-promoted';
    if (age < 1000) return 'early-discard';
    return 'incomplete-status';
  }
}
