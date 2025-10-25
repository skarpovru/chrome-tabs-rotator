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
  private static readonly PRELOAD_DISABLE_THRESHOLD = 5; // consecutive no-event failures
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
    delegateInvariant: () => Promise<void>,
    opts?: { reuseLocalFileTabs?: boolean }
  ): Promise<void> {
    const tabConfig = tabsConfig?.tabs?.find(
      (t) => t.tabId === tabId || t.nextTabId === tabId
    );
    if (!tabConfig) return;
    try {
      // Policy: skip preload creation for file:// schemes or when explicitly disabled
      const scheme = tabConfig.page?.url?.split(':')[0];
      const skipPreloadPolicy =
        ((opts?.reuseLocalFileTabs ?? false) && scheme === 'file') ||
        tabConfig.preloadDisabled === true;
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
      // Only create a preload if the primary is NOT currently active (background refresh) OR we are single page.
      let primaryActive = false;
      if (tabConfig.tabId > 0) {
        try { const t = await chrome.tabs.get(tabConfig.tabId); primaryActive = !!t?.active; } catch {}
      }
      const singlePage = (tabsConfig?.tabs?.length || 0) <= 1;
      if (!existingPreloadId && !backoffActive && !skipPreloadPolicy && (!primaryActive || singlePage)) {
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
            // Extended wait for slow connections (configurable future): 10000ms
            await this.waitForInitialLoad(tabConfig, 10000);
        } catch (e) {
          console.debug('[tabLifecycle] waitForInitialLoad error', e);
        }
      }

      const readyPreload = tabConfig.nextTabId > 0 && tabConfig.nextTabIdReady;
      if (readyPreload) {
        // Promote only when preload is ready; do not activate immediately if old primary was active
        const oldPrimary = tabConfig.tabId > 0 ? tabConfig.tabId : undefined;
        const oldPrimaryWasActive = primaryActive;
        tabConfig.tabId = tabConfig.nextTabId;
        tabConfig.tabIdReady = true;
        tabConfig.nextTabId = 0;
        tabConfig.nextTabIdReady = false;
        tabConfig.lastPromotionAt = Date.now();
        // Remove old primary AFTER promotion without re-focusing preload (rotation will focus later)
        if (oldPrimary) {
          try { await chrome.tabs.remove(oldPrimary); } catch {}
        }
        tabConfig.deferredReloadDue = false; // clear flag on success
        await setStateCb([
          ...(tabsConfig?.tabs
            ?.flatMap((t) => [t.tabId, t.nextTabId])
            .filter((id) => id && id > 0) as number[]),
        ]);
        await delegateInvariant();
        console.log('[tabLifecycle] Reload promotion completed (background)', {
          newPrimary: tabConfig.tabId,
          oldPrimary,
          oldPrimaryWasActive,
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
    tabConfig.preloadDisabled = false;
    tabConfig.preloadDisabledReason = undefined;
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
          // Only remove the failed preload, keep the primary tab in rotationState.tabIds
          await setStateCb([
            ...(tabsConfig?.tabs
              ?.flatMap((t) => [t.tabId]) // Only include tabId (primary) for each tab
              .filter((id) => id && id > 0) as number[]),
          ]);
            // Apply exponential backoff after failed preload
            tabConfig.preloadFailureCount = (tabConfig.preloadFailureCount ?? 0) + 1;
            const base = 2000; // 2s base
            const max = 60000; // 60s cap
            const prevBackoff = tabConfig.currentPreloadBackoffMs ?? 0;
            const next = prevBackoff > 0 ? Math.min(prevBackoff * 2, max) : base;
            tabConfig.currentPreloadBackoffMs = next;
            tabConfig.nextPreloadAllowedAt = Date.now() + next;
            // Disable further preloads after threshold of no-event failures
            if ((tabConfig.preloadFailureCount ?? 0) >= TabLifecycleService.PRELOAD_DISABLE_THRESHOLD) {
              tabConfig.preloadDisabled = true;
              tabConfig.preloadDisabledReason = 'no-events-threshold';
            }
        }
        if (tabConfig.tabId > 0) {
          // Reload primary in-place only if we never created a valid preload (or policy skip)
          console.log('[tabLifecycle] Fallback in-place reload primary', tabConfig.tabId);
          try { await chrome.tabs.reload(tabConfig.tabId); } catch {}
        } else if (skipPreloadPolicy && tabConfig.tabId > 0) {
          // Policy skip path already handled by primary reload above
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
      const baseTimeout = timeoutMs;
      const maxTimeout = baseTimeout * 3; // cap at 3x
      let currentDeadline = start + baseTimeout;
      let extended = false;
      let lastProgressAt = start;
      const progressExtendWindowMs = 2500; // require min spacing between extensions
      const extensionFactor = 1.5; // multiply remaining budget
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
              // Dynamic timeout extension: if we see forward progress and still below max cap
              const now = Date.now();
              const statuses = tabConfig.preloadStatusesSeen;
              const progressEvents = statuses.filter(s => s === 'loading' || s === 'unknown');
              if (!resolved && now < currentDeadline && progressEvents.length > 0) {
                const sinceLast = now - lastProgressAt;
                if (sinceLast >= progressExtendWindowMs) {
                  const remaining = currentDeadline - now;
                  const proposedExtra = Math.floor(remaining * (extensionFactor - 1));
                  const newDeadline = Math.min(currentDeadline + proposedExtra, start + maxTimeout);
                  if (newDeadline > currentDeadline) {
                    currentDeadline = newDeadline;
                    extended = true;
                    lastProgressAt = now;
                    if ((tabConfig as any).debugDynamicTimeout) {
                      console.debug('[tabLifecycle] dynamic preload timeout extended', {
                        tabId: updatedTabId,
                        statuses,
                        newDeadline,
                        elapsed: now - start,
                      });
                    }
                  }
                }
              }
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
      // Poll for deadline rather than single setTimeout to respect dynamic extensions
      const deadlineCheck = () => {
        if (resolved) return;
        const now = Date.now();
        if (now >= currentDeadline) {
          if (!resolved) {
            tabConfig.lastPreloadWaitOutcome =
              tabConfig.lastPreloadWaitOutcome || 'timeout';
            if (tabConfig.tabId > 0 && !((tabConfig.primaryInitialWaitMs ?? 0) > 0)) {
              tabConfig.primaryInitialWaitMs = now - start;
              tabConfig.primaryInitialWaitOutcome = 'timeout';
            }
          }
          done();
          return;
        }
        setTimeout(deadlineCheck, 250);
      };
      setTimeout(deadlineCheck, 250);
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
