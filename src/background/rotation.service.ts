import {
  ConfigData,
  RemoteSettings,
  RotationState,
  StorageKeys,
  TabConfig,
  TabsConfig,
} from '../app/models';
import { ConfigValidatorService, ToolbarManagerService } from '../app/services';
import { CustomHttpClient } from './custom-http-client.service';
import isEqual from 'lodash/isEqual';

/**
 * RotationService (MV3-friendly)
 */
export class RotationService {
  private rotationState = new RotationState();
  private maxRetries = 1;
  private defaultFailedPageReloadIntervalSeconds = 120;

  private currentIndex = 0;
  private tabsConfig?: TabsConfig;
  private currentConfig?: ConfigData;
  private windowId?: number;

  // Guards
  private rotating = false;
  private starting = false;
  private creatingTabs = new WeakSet<TabConfig>();
  private static readonly MAX_TABS_PER_PAGE = 2;

  // Anti-spam: skip enforcement until this time (ms since epoch)
  private enforceResumeAt = 0;

  private static readonly ALARM_ROTATE = 'rotate';
  private static readonly ALARM_CONFIG = 'configReload';

  private stopping = false;
  // Diagnostics timestamps
  private lastRotationAt: number | null = null; // ms since epoch of last successful rotateTabs end
  private nextRotationDueAt: number | null = null; // ms since epoch when next rotate alarm should fire

  // Watchdog
  private static readonly ALARM_WATCHDOG = 'rotationWatchdog';
  private watchdogIntervalSeconds = 60; // check every 60s
  private watchdogGraceSeconds = 10; // grace after expected due time
  // Focus diagnostics
  private lastFocusAttemptAt: number | null = null; // ms epoch
  private lastFocusAttemptSource: string | null = null; // 'rotateTabs' | 'openNextPageTab' | 'tryFullscreen'
  private lastFocusAttemptWindowId: number | null = null;
  private lastFocusAttemptSucceeded: boolean | null = null;
  private lastFocusAttemptError: string | null = null;
  public isStopping(): boolean {
    return this.stopping;
  }

  get isRotating(): boolean {
    return this.rotationState?.isRotating || false;
  }

  constructor(
    private http: CustomHttpClient,
    private configValidator: ConfigValidatorService,
    private toolbarManagerService: ToolbarManagerService
  ) {
    this.restorePreviousRotationState();
  }

  private async restorePreviousRotationState(): Promise<void> {
    try {
      console.log('[rotator] Restore previous rotation state.');
      const result = await chrome.storage.local.get(StorageKeys.RotationState);
      const rotationState =
        (result?.[StorageKeys.RotationState] as RotationState) ||
        new RotationState();

      // Do NOT remove tabs here — worker may restart in MV3
      this.rotationState = rotationState;
      this.currentIndex = Number((rotationState as any)?.currentIndex ?? 0);
      // Try to rebuild in-memory mapping so alarms work immediately after wake
      await this.rebuildTabsFromState();
    } catch (error) {
      console.error('[rotator] Failed to restore rotation state:', error);
    }
  }

  public async rescheduleIfNeeded(): Promise<void> {
    try {
      const state = (
        await chrome.storage.local.get(StorageKeys.RotationState)
      )?.[StorageKeys.RotationState] as any;

      if (!state?.isRotating) return;

      this.rotationState = state as RotationState;
      this.currentIndex = Number(state?.currentIndex ?? 0);

      // If Chrome restarted, previously tracked tabs may no longer exist.
      // Ensure we still have a complete set of tabs for the configured pages; otherwise re-initialize.
      const { loadedConfig } =
        await this.loadActualConfigurationFromLocalStorage();
      const expectedPages = loadedConfig?.pages?.length ?? 0;
      let aliveCount = 0;
      const tracked = Array.isArray(this.rotationState.tabIds)
        ? [...new Set(this.rotationState.tabIds)]
        : [];
      for (const id of tracked) {
        try {
          if (id && (await this.ensureTabExists(id))) aliveCount++;
        } catch {}
      }

      // If no tabs (or fewer than pages configured) are alive, perform a clean initialize to recreate them.
      if (expectedPages > 0 && aliveCount < expectedPages) {
        await this.initialize();
        return;
      }

      const alarms = await chrome.alarms.getAll();
      const hasRotate = alarms.some(
        (a) => a.name === RotationService.ALARM_ROTATE
      );
      if (!hasRotate) {
        chrome.alarms.create(RotationService.ALARM_ROTATE, {
          when: Date.now() + 1000,
        });
      }

      const useRemote = (
        await chrome.storage.local.get(StorageKeys.UseRemoteConfig)
      )?.[StorageKeys.UseRemoteConfig] as boolean;
      if (useRemote) {
        const rs = (
          await chrome.storage.local.get(StorageKeys.RemoteSettings)
        )?.[StorageKeys.RemoteSettings] as RemoteSettings | undefined;
        const minutes = rs?.configReloadIntervalMinutes ?? 0;
        if (
          minutes > 0 &&
          !alarms.some((a) => a.name === RotationService.ALARM_CONFIG)
        ) {
          chrome.alarms.create(RotationService.ALARM_CONFIG, {
            periodInMinutes: minutes,
          });
        }
      }
    } catch (e) {
      console.error(
        '[rotator] rescheduleIfNeeded failed',
        e,
        chrome.runtime.lastError
      );
    }
  }

  async initialize(): Promise<void> {
    if (this.starting) {
      console.info('[rotator] initialize already in progress; skipping.');
      return;
    }
    this.starting = true;
    try {
      console.log('[rotator] initialize');

      // Clear alarms from any previous run
      await chrome.alarms.clear(RotationService.ALARM_ROTATE);
      await chrome.alarms.clear(RotationService.ALARM_CONFIG);
      await chrome.alarms.clear(RotationService.ALARM_WATCHDOG);
      // Clear all leftover reload:* alarms
      const all = await chrome.alarms.getAll();
      await Promise.all(
        all
          .filter((a) => a.name.startsWith('reload:'))
          .map((a) => chrome.alarms.clear(a.name))
      );

      if (this.isRotating) {
        await this.stopRotation();
      }

      try {
        const wnd = await chrome.windows.getLastFocused();
        this.windowId = wnd?.id;
      } catch (e) {
        console.warn('[rotator] getLastFocused failed', e);
      }

      this.enforceResumeAt = Date.now() + 15000; // 15s grace

      const { loadedConfig, loadedRemoteSettings } =
        await this.loadActualConfigurationFromLocalStorage();

      const startRotation = async (config: ConfigData) => {
        if (!config?.pages || config.pages.length === 0) {
          console.warn(
            '[rotator] No pages configured — not starting rotation.'
          );
          await this.setRotationState(false);
          return;
        }
        await this.setRotationState(true);
        await this.createTabs(config);
        await this.tryFullscreen(config);
        await this.startRotationProcess(config);
      };

      if (
        !loadedRemoteSettings ||
        !loadedRemoteSettings.configUrl ||
        !(loadedRemoteSettings.configReloadIntervalMinutes > 0)
      ) {
        // Local config path
        await startRotation(loadedConfig);
      } else {
        // Remote config path: try now, and schedule periodic reloads
        const loadAndStartRotation = async () => {
          try {
            const remoteConfig = await this.loadRemoteConfig(
              loadedRemoteSettings.configUrl!
            );
            if (remoteConfig && !isEqual(this.currentConfig, remoteConfig)) {
              await chrome.storage.local.set({
                [StorageKeys.RemoteConfig]: remoteConfig,
              });
              console.info('[rotator] Remote config saved to local storage.');
              if (this.isRotating) await this.stopRotation();
              await startRotation(remoteConfig);
            } else if (!this.isRotating) {
              // Remote fetch failed or unchanged — fall back to last saved config
              if (loadedConfig?.pages?.length) {
                await startRotation(loadedConfig);
              } else {
                await this.setRotationState(false);
              }
            }
          } catch (error) {
            console.error(
              '[rotator] Failed to load remote configuration:',
              error
            );
            // Fall back to last saved config if present
            if (!this.isRotating) {
              if (loadedConfig?.pages?.length) {
                await startRotation(loadedConfig);
              } else {
                await this.setRotationState(false);
              }
            }
          }
        };

        await loadAndStartRotation();
        chrome.alarms.create(RotationService.ALARM_CONFIG, {
          periodInMinutes: loadedRemoteSettings.configReloadIntervalMinutes,
        });
      }
      // Start watchdog after initialization
      chrome.alarms.create(RotationService.ALARM_WATCHDOG, {
        periodInMinutes: this.watchdogIntervalSeconds / 60,
      });
    } catch (error) {
      console.error('[rotator] Failed to initialize rotation:', error);
      throw error;
    } finally {
      this.starting = false;
    }
  }

  private async tryFullscreen(configData: ConfigData) {
    if (!configData.isFullscreen) return;
    try {
      const first = this.tabsConfig?.tabs?.[0];
      if (first?.tabId) {
        const tab = await chrome.tabs.get(first.tabId);
        if (tab?.windowId != null) {
          await chrome.windows.update(tab.windowId, {
            state: 'fullscreen',
            focused: !configData.preventWindowFocus,
          });
          if (!configData.preventWindowFocus) {
            this.recordFocusAttempt('tryFullscreen', tab.windowId, true);
          } else {
            this.recordFocusAttempt('tryFullscreen', tab.windowId, false, 'suppressed-by-config');
          }
          this.windowId = tab.windowId;
          console.info('[rotator] Entered fullscreen on window', this.windowId);
          return;
        }
      }
      if (this.windowId != null) {
        await chrome.windows.update(this.windowId, {
          state: 'fullscreen',
          focused: true,
        });
        this.recordFocusAttempt('tryFullscreen', this.windowId, true);
        console.info(
          '[rotator] Entered fullscreen on lastFocused window',
          this.windowId
        );
      }
    } catch (e) {
      this.recordFocusAttempt('tryFullscreen', this.windowId ?? null, false, String(e));
      console.warn(
        '[rotator] Failed to enter fullscreen (policy/OS may block):',
        e
      );
    }
  }

  private waitForTabToLoad(tabConfig: TabConfig): Promise<void> {
    return new Promise(async (resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          try {
            chrome.tabs.onUpdated.removeListener(listener);
          } catch {}
          resolve();
        }
      };
      const listener = (
        updatedTabId: number,
        changeInfo: chrome.tabs.OnUpdatedInfo
      ) => {
        if (
          tabConfig &&
          (updatedTabId === tabConfig.tabId ||
            updatedTabId === tabConfig.nextTabId) &&
          changeInfo.status === 'complete'
        ) {
          if (tabConfig.nextTabId === updatedTabId) {
            tabConfig.nextTabIdReady = true;
          } else {
            tabConfig.tabIdReady = true;
          }
          console.log('[rotator] Initial loading complete', tabConfig);
          done();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);

      // Immediate check
      try {
        const id =
          tabConfig.nextTabId > 0 ? tabConfig.nextTabId : tabConfig.tabId;
        if (id) {
          await chrome.tabs.get(id);
          setTimeout(done, 250);
        }
      } catch {}

      // Fallback timeout
      setTimeout(done, 8000);
    });
  }

  private async startRotationProcess(configData: ConfigData): Promise<void> {
    console.log('[rotator] Start rotation process');
    try {
      await this.setRotationState(
        true,
        this.tabsConfig?.tabs.map((tab) => tab.tabId)
      );
      await this.rotateTabs();
    } catch (error) {
      console.error('[rotator] Failed to start rotation process:', error);
      throw error;
    }
  }

  async stopRotation(): Promise<void> {
    console.log('[rotator] Stop rotation process');
    this.stopping = true;
    try {
      await chrome.alarms.clear(RotationService.ALARM_ROTATE);
      await chrome.alarms.clear(RotationService.ALARM_CONFIG);
      await chrome.alarms.clear(RotationService.ALARM_WATCHDOG);

      if (this.tabsConfig?.tabs?.length) {
        for (const t of this.tabsConfig.tabs) {
          this.clearReloadAlarmForTab(t.tabId);
          this.clearReloadAlarmForTab(t.nextTabId);
        }
      }

      await this.removeTabs(this.rotationState?.tabIds || []);
      await this.setRotationState(false, []);
      this.currentIndex = 0;
      await this.persistCurrentIndex();
      // Fully clear in-memory tab descriptors so diagnostics does not show stale allowedIds
      this.tabsConfig = new TabsConfig();
      // Reset timing expectations
      this.nextRotationDueAt = null;
    } catch (error) {
      console.error('[rotator] Failed to stop rotation:', error);
      throw error;
    } finally {
      this.stopping = false;
    }
  }

  async tryRemoveTabFromRotationOnClose(tabId: number): Promise<void> {
    if (this.stopping) return; // silence removal noise

    const tabConfig = this.tabsConfig?.tabs?.find(
      (tab) => tab.tabId === tabId || tab.nextTabId === tabId
    );
    if (!tabConfig) return;

    console.log('[rotator] Removing closed tab', tabId);
    if (tabConfig.nextTabId === tabId) {
      tabConfig.nextTabIdReady = false;
      tabConfig.nextTabId = 0;
    } else {
      tabConfig.tabIdReady = false;
      tabConfig.tabId = 0;
    }

    this.clearReloadAlarmForTab(tabId);

    if (!(tabConfig.tabId > 0 || tabConfig.nextTabId > 0)) {
      this.removeReloadTimer(tabConfig);
    }
    await this.setRotationState(
      this.isRotating,
      this.rotationState.tabIds?.filter((id) => id !== tabId)
    );
  }

  async onPageLoaded(tabId: number, url: string): Promise<void> {
    const tabConfig = this.tabsConfig?.tabs?.find(
      (tab) => tab.tabId === tabId || tab.nextTabId === tabId
    );
    if (!tabConfig || tabConfig.page.url !== url) return;

    console.log('[rotator] Page loaded', tabId);

    if (tabConfig.nextTabId === tabId) {
      tabConfig.nextTabIdReady = true;
    } else {
      tabConfig.tabIdReady = true;
    }

    this.removeReloadTimer(tabConfig);
    await this.enforceTabInvariant();

    if (tabConfig.page.reloadIntervalSeconds > 0) {
      const targetId =
        tabConfig.nextTabId > 0 ? tabConfig.nextTabId : tabConfig.tabId;
      this.scheduleReloadAlarm(targetId, tabConfig.page.reloadIntervalSeconds);
    }
  }

  async onHandleError(tabId: number, errorUrl: string): Promise<void> {
    const tabConfig = this.tabsConfig?.tabs?.find(
      (tab) => tab.tabId === tabId || tab.nextTabId === tabId
    );
    if (!tabConfig || tabConfig.page.url !== errorUrl) return;

    console.info('[rotator] Page failed', tabId, errorUrl);

    if (tabConfig.retryCount < this.maxRetries) {
      tabConfig.retryCount++;
      try {
        await chrome.tabs.update(tabId, { url: tabConfig.page.url });
      } catch (error) {
        console.error('[rotator] Error updating tab:', error);
      }
    } else {
      if (tabConfig.nextTabId === tabId) {
        tabConfig.nextTabIdReady = false;
      } else {
        tabConfig.tabIdReady = false;
      }
      this.removeReloadTimer(tabConfig);

      const failedPageReloadIntervalSeconds =
        tabConfig.page.reloadIntervalSeconds > 0 &&
        this.defaultFailedPageReloadIntervalSeconds >
          tabConfig.page.reloadIntervalSeconds
          ? tabConfig.page.reloadIntervalSeconds
          : this.defaultFailedPageReloadIntervalSeconds;

      this.scheduleReloadAlarm(tabId, failedPageReloadIntervalSeconds);

      console.info(
        '[rotator] Tab removed from rotation due to repeated errors:',
        tabId
      );
    }
  }

  public async onRotateAlarm(): Promise<void> {
    // Worker may have restarted; rebuild memory state & current index
    await this.rebuildTabsFromState();
    const stored = (
      await chrome.storage.local.get(StorageKeys.RotationState)
    )?.[StorageKeys.RotationState] as any;
    if (stored && typeof stored.currentIndex === 'number') {
      const len = this.tabsConfig?.tabs.length || 1;
      this.currentIndex = len > 0 ? stored.currentIndex % len : 0;
    }
    await this.rotateTabs();
  }

  public async onWatchdogAlarm(): Promise<void> {
    if (!this.isRotating) return; // nothing to do
    const now = Date.now();
    let didHeal = false;
    if (
      this.nextRotationDueAt &&
      now > this.nextRotationDueAt + this.watchdogGraceSeconds * 1000
    ) {
      const overdueSeconds = Math.round((now - this.nextRotationDueAt) / 1000);
      console.warn(
        '[rotator] Watchdog detected overdue rotation (overdue=%ds). Attempting self-heal.',
        overdueSeconds
      );
      didHeal = true;
      try {
        // Rebuild state & enforce invariants immediately
        await this.rebuildTabsFromState();
        await this.enforceTabInvariant(true);
        // If alarm somehow missing, create a near-immediate rotate
        const rotateAlarm = await chrome.alarms.get(
          RotationService.ALARM_ROTATE
        );
        if (!rotateAlarm) {
          chrome.alarms.create(RotationService.ALARM_ROTATE, {
            when: Date.now() + 1000,
          });
          console.info('[rotator] Watchdog scheduled immediate rotate alarm.');
        } else {
          // Force rotate directly (might have stuck due to missed alarm)
          await this.rotateTabs();
        }
      } catch (e) {
        console.error('[rotator] Watchdog self-heal failed', e);
      }
    }
    // Even if not overdue, periodically prune extras (lightweight) once per watchdog tick
    if (!didHeal) {
      try {
        await this.enforceTabInvariant();
      } catch (e) {
        console.debug('[rotator] Watchdog invariant check skipped', e);
      }
    }
  }

  public async onConfigReloadAlarm(): Promise<void> {
    try {
      const useRemote = (
        await chrome.storage.local.get(StorageKeys.UseRemoteConfig)
      )?.[StorageKeys.UseRemoteConfig] as boolean;
      if (!useRemote) return;

      const rs = (await chrome.storage.local.get(StorageKeys.RemoteSettings))?.[
        StorageKeys.RemoteSettings
      ] as RemoteSettings | undefined;
      if (!rs?.configUrl) return;

      const remoteConfig = await this.loadRemoteConfig(rs.configUrl);
      if (remoteConfig && !isEqual(this.currentConfig, remoteConfig)) {
        await chrome.storage.local.set({
          [StorageKeys.RemoteConfig]: remoteConfig,
        });
        console.info('[rotator] Remote config updated via alarm.');

        if (this.isRotating) {
          await this.stopRotation();
        }
        await this.setRotationState(true);
        await this.createTabs(remoteConfig);
        await this.tryFullscreen(remoteConfig);
        await this.startRotationProcess(remoteConfig);
      }
    } catch (e) {
      console.error(
        '[rotator] onConfigReloadAlarm error:',
        e,
        chrome.runtime.lastError
      );
    }
  }

  public async onReloadAlarm(tabId: number): Promise<void> {
    await this.rebuildTabsFromState();
    const tabConfig = this.tabsConfig?.tabs?.find(
      (t) => t.tabId === tabId || t.nextTabId === tabId
    );
    if (!tabConfig) return;
    try {
      if (tabConfig.nextTabId > 0) {
        console.log('[rotator] Reloading next tab', tabConfig.nextTabId);
        await chrome.tabs.reload(tabConfig.nextTabId);
      } else {
        console.log(
          '[rotator] Creating fresh tab for page reload',
          tabConfig.tabId
        );
        await this.createTab(tabConfig);
        await this.setRotationState(this.rotationState.isRotating, [
          ...this.rotationState.tabIds,
          tabConfig.nextTabId > 0 ? tabConfig.nextTabId : tabConfig.tabId,
        ]);
        await this.enforceTabInvariant();
      }
    } catch (error) {
      console.error(
        '[rotator] Error in onReloadAlarm:',
        error,
        chrome.runtime.lastError
      );
    }
  }

  private clearReloadAlarmForTab(tabId?: number) {
    if (tabId && tabId > 0) {
      chrome.alarms.clear(`reload:${tabId}`);
    }
  }

  private scheduleReloadAlarm(tabId: number, seconds: number) {
    if (!tabId || tabId <= 0) return;
    chrome.alarms.create(`reload:${tabId}`, {
      when: Date.now() + seconds * 1000,
    });
  }

  private async setRotationState(
    rotating: boolean,
    tabIds?: number[]
  ): Promise<void> {
    console.log('[rotator] Set rotation state.', rotating, tabIds);
    if (this.rotationState?.isRotating === rotating && !tabIds) {
      return;
    }
    if (!this.rotationState) {
      this.rotationState = new RotationState({ isRotating: rotating });
    } else {
      this.rotationState.isRotating = rotating;
    }

    if (tabIds) {
      this.rotationState.tabIds = tabIds;
    }

    // Always normalize ordering when rotating and we have a tabsConfig so that
    // the first N tracked IDs align with page indices. This ensures rebuildTabsFromState
    // maps pages -> correct current tab even after swaps / reload preloading.
    if (rotating && this.tabsConfig?.tabs?.length) {
      const ordered: number[] = [];
      // First pass: primary tab IDs in page order
      for (const t of this.tabsConfig.tabs) {
        if (t.tabId > 0) ordered.push(t.tabId);
      }
      // Second pass: any nextTabIds (preloaded) in the same page order
      for (const t of this.tabsConfig.tabs) {
        if (t.nextTabId > 0) ordered.push(t.nextTabId);
      }
      // Only replace if we actually built a sequence (avoid wiping state during early init)
      if (ordered.length) {
        this.rotationState.tabIds = ordered;
      }
    }

    try {
      await chrome.storage.local.set({
        [StorageKeys.RotationState]: this.rotationState,
      });
      await this.toolbarManagerService.trySetToolbarIcon(rotating);
    } catch (error) {
      console.error('[rotator] Failed to set rotation state:', error);
    }
  }

  private async persistCurrentIndex() {
    try {
      const current = (
        await chrome.storage.local.get(StorageKeys.RotationState)
      )?.[StorageKeys.RotationState] as any;
      await chrome.storage.local.set({
        [StorageKeys.RotationState]: {
          ...(current ?? {}),
          isRotating: this.rotationState.isRotating,
          tabIds: this.rotationState.tabIds,
          currentIndex: this.currentIndex,
        },
      });
    } catch (e) {
      console.error('[rotator] persistCurrentIndex failed', e);
    }
  }

  private async rotateTabs(): Promise<void> {
    if (this.rotating) {
      console.info('[rotator] rotate: already running; skip.');
      return;
    }
    this.rotating = true;
    try {
      // Defensive: validate rotation conditions
      if (!this.isRotating) {
        console.warn('[rotator] rotate called while not rotating — ignoring.');
        return;
      }
      const tabCount = this.tabsConfig?.tabs?.length || 0;
      if (!this.tabsConfig || tabCount === 0) {
        console.warn('[rotator] No tabs configured yet.');
        await this.setRotationState(false);
        return;
      }
      if (this.currentIndex < 0 || this.currentIndex >= tabCount) {
        console.warn(
          '[rotator] currentIndex out of range; resetting to 0',
          this.currentIndex,
          tabCount
        );
        this.currentIndex = 0;
        await this.persistCurrentIndex();
      }

      const currentTab = this.tabsConfig.tabs[this.currentIndex];
      if (!currentTab) {
        console.warn(
          '[rotator] No current tab (index=%d) — scheduling retry in 5s',
          this.currentIndex
        );
        await chrome.alarms.clear(RotationService.ALARM_ROTATE);
        chrome.alarms.create(RotationService.ALARM_ROTATE, {
          when: Date.now() + 5000,
        });
        return;
      }
      console.debug(
        '[rotator] Rotating to index=%d of %d (tabId=%d nextTabId=%d)',
        this.currentIndex,
        tabCount,
        currentTab.tabId,
        currentTab.nextTabId
      );

      if (currentTab.nextTabId > 0 && currentTab.nextTabIdReady) {
        await this.openNextPageTab(currentTab);
      } else {
        const targetId = currentTab.tabId > 0 ? currentTab.tabId : currentTab.nextTabId;
        if (targetId > 0) {
          try {
            await chrome.tabs.update(targetId, { active: true });
            await this.attemptFocus('rotateTabs', targetId);
          } catch (error) {
            console.error('[rotator] Error updating tab:', error);
          }
        }
      }
      const delaySeconds = Math.max(
        1,
        Number(currentTab.page?.delaySeconds) || 1
      );
      await this.scheduleNextRotation(delaySeconds);
      // Light periodic cleanup of stale tracked IDs (non-force respects grace window)
      try { await this.enforceTabInvariant(); } catch {}
    } finally {
      this.rotating = false;
    }
  }

  private async scheduleNextRotation(delaySeconds: number): Promise<void> {
    const tabCount = this.tabsConfig?.tabs?.length || 0;
    if (tabCount === 0) {
      console.warn(
        '[rotator] scheduleNextRotation: no tabs; abort scheduling.'
      );
      return;
    }
    this.currentIndex = (this.currentIndex + 1) % tabCount;
    await this.persistCurrentIndex();
    await chrome.alarms.clear(RotationService.ALARM_ROTATE);
    const when = Date.now() + Math.max(1, delaySeconds) * 1000;
    chrome.alarms.create(RotationService.ALARM_ROTATE, { when });
    this.lastRotationAt = Date.now();
    this.nextRotationDueAt = when;
    console.debug(
      '[rotator] Scheduled next rotation index=%d in %ds (tabs=%d)',
      this.currentIndex,
      delaySeconds,
      tabCount
    );
  }

  private async openNextPageTab(tabConfig: TabConfig): Promise<void> {
    if (!(tabConfig.nextTabId > 0)) {
      console.error('[rotator] Next page tab ID is not defined.', tabConfig);
      return;
    }
    try {
      await chrome.tabs.update(tabConfig.nextTabId, { active: true });
      await this.attemptFocus('openNextPageTab', tabConfig.nextTabId);
      const tabIdToRemove = tabConfig.tabId;
      this.clearReloadAlarmForTab(tabIdToRemove);
      await this.removeTabs([tabIdToRemove]);
      await this.setRotationState(
        this.isRotating,
        this.rotationState.tabIds?.filter((id) => id !== tabIdToRemove)
      );

      tabConfig.tabId = tabConfig.nextTabId;
      tabConfig.nextTabId = 0;
      tabConfig.tabIdReady = true;
      tabConfig.nextTabIdReady = false;
      console.log('[rotator] Switched to next page tab', tabConfig.tabId);
    } catch (error) {
      console.error('[rotator] Error in open next page tab:', error);
    }
  }

  private async loadActualConfigurationFromLocalStorage(): Promise<{
    loadedConfig: ConfigData;
    loadedRemoteSettings?: RemoteSettings;
  }> {
    try {
      console.log('[rotator] Loading configuration from local storage.');
      const useRemoteConfigResult = await chrome.storage.local.get(
        StorageKeys.UseRemoteConfig
      );
      const useRemoteConfig =
        useRemoteConfigResult[StorageKeys.UseRemoteConfig] || false;

      if (useRemoteConfig) {
        const remoteSettingsResult = await chrome.storage.local.get(
          StorageKeys.RemoteSettings
        );
        const remoteConfigResult = await chrome.storage.local.get(
          StorageKeys.RemoteConfig
        );
        const loadedRemoteSettings = remoteSettingsResult[
          StorageKeys.RemoteSettings
        ] as RemoteSettings | undefined;
        const loadedConfig =
          (remoteConfigResult[StorageKeys.RemoteConfig] as
            | ConfigData
            | undefined) || new ConfigData();

        this.currentConfig = loadedConfig;
        return { loadedConfig, loadedRemoteSettings };
      } else {
        const localConfigResult = await chrome.storage.local.get(
          StorageKeys.LocalConfig
        );
        const loadedConfig =
          (localConfigResult[StorageKeys.LocalConfig] as
            | ConfigData
            | undefined) || new ConfigData();

        this.currentConfig = loadedConfig;
        return { loadedConfig };
      }
    } catch (error) {
      console.error(
        '[rotator] Failed to load configuration from local storage:',
        error
      );
      // Return an empty config instead of throwing — first run support
      return { loadedConfig: new ConfigData() };
    }
  }

  private async ensureTabExists(tabId?: number): Promise<boolean> {
    if (!tabId || tabId <= 0) return false;
    try {
      await chrome.tabs.get(tabId);
      return true;
    } catch {
      return false;
    }
  }

  private async createTab(tabConfig: TabConfig): Promise<TabConfig> {
    if (!tabConfig?.page?.url) {
      console.error('[rotator] Error creating tab, url not defined.');
      return tabConfig;
    }
    if (this.creatingTabs.has(tabConfig)) {
      console.info('[rotator] createTab skipped: already creating.');
      return tabConfig;
    }

    if (
      tabConfig.nextTabId > 0 &&
      !(await this.ensureTabExists(tabConfig.nextTabId))
    ) {
      tabConfig.nextTabId = 0;
      tabConfig.nextTabIdReady = false;
    }
    if (tabConfig.tabId > 0 && !(await this.ensureTabExists(tabConfig.tabId))) {
      tabConfig.tabId = 0;
      tabConfig.tabIdReady = false;
    }

    if (tabConfig.nextTabId > 0) {
      console.log('[rotator] Next tab already set, not creating new one.');
      return tabConfig;
    }

    try {
      this.creatingTabs.add(tabConfig);

      const tab = await chrome.tabs.create({
        url: tabConfig.page.url,
        active: tabConfig.active,
        windowId: this.windowId,
      });

      if (tabConfig.tabId > 0) {
        tabConfig.nextTabId = tab.id!;
      } else {
        tabConfig.tabId = tab.id!;
        // Mark first created visible tab as ready to avoid initial gating
        tabConfig.tabIdReady = true;
      }

      // Capture windowId from created tab if missing
      if (this.windowId == null && tab.windowId != null) {
        this.windowId = tab.windowId;
      }

      const ids = new Set<number>(this.rotationState.tabIds ?? []);
      ids.add(tab.id!);
      await this.setRotationState(this.rotationState.isRotating, [...ids]);
    } catch (error) {
      console.error('[rotator] Error creating tab', tabConfig.page.url, error);
    } finally {
      this.creatingTabs.delete(tabConfig);
    }
    return tabConfig;
  }

  private async createTabs(configData: ConfigData): Promise<void> {
    console.log('[rotator] Creating tabs:', configData);
    if (!configData?.pages || configData.pages.length === 0) return;

    this.tabsConfig = new TabsConfig();
    const tabPromises = configData.pages.map(async (page, index) => {
      const tab = new TabConfig({ page, active: index === 0 });
      const createdTab = await this.createTab(tab);
      if (createdTab) {
        this.tabsConfig?.tabs.push(createdTab);
        await this.waitForTabToLoad(createdTab);
      }
      return createdTab;
    });

    await Promise.all(tabPromises);
  }

  private async removeTabs(tabIds: number[]): Promise<void> {
    if (!tabIds?.length) return;
    console.log('[rotator] Removing tabs:', tabIds);
    try {
      const existing: number[] = [];
      for (const id of tabIds) {
        if (await this.ensureTabExists(id)) existing.push(id);
      }
      await Promise.all(existing.map((tabId) => chrome.tabs.remove(tabId)));
    } catch (error) {
      console.error('[rotator] Failed to remove tabs:', error);
    }
  }

  private removeReloadTimer(tabConfig: TabConfig) {
    tabConfig.retryCount = 0;
    const targetId =
      tabConfig.nextTabId > 0 ? tabConfig.nextTabId : tabConfig.tabId;
    this.clearReloadAlarmForTab(targetId);
  }

  private async loadRemoteConfig(url: string): Promise<ConfigData | undefined> {
    console.log('[rotator] Loading remote configuration:', url);
    try {
      const configData = await this.http.get<ConfigData>(url);
      this.configValidator.validateConfigData(configData);
      return configData;
    } catch (error) {
      console.error('[rotator] Failed to load/validate configuration.', error);
      return undefined;
    }
  }

  private async enforceTabInvariant(force = false): Promise<void> {
    if (!force && Date.now() < this.enforceResumeAt) return;
    if (!this.tabsConfig?.tabs?.length) return;

    const allowed = new Set<number>();
    for (const t of this.tabsConfig.tabs) {
      if (t.tabId > 0) allowed.add(t.tabId);
      if (t.nextTabId > 0) allowed.add(t.nextTabId);
    }

    const maxAllowed =
      this.tabsConfig.tabs.length * RotationService.MAX_TABS_PER_PAGE;
    const current = [...new Set(this.rotationState.tabIds ?? [])];

    const extras: number[] = [];
    for (const id of current) {
      if (!allowed.has(id)) extras.push(id);
    }

    const extrasExisting: number[] = [];
    for (const id of extras) {
      if (await this.ensureTabExists(id)) extrasExisting.push(id);
    }

    const remaining = current.filter((id) => !extrasExisting.includes(id));
    if (remaining.length > maxAllowed) {
      extrasExisting.push(...remaining.slice(maxAllowed));
    }

    if (extrasExisting.length) {
      console.warn('[rotator] Anti-spam: removing extra tabs', extrasExisting);
      await this.removeTabs(extrasExisting);
    }

    const newTracked: number[] = [];
    for (const id of current) {
      if (allowed.has(id)) {
        newTracked.push(id);
      } else if (!extrasExisting.includes(id)) {
        const exists = await this.ensureTabExists(id);
        if (exists) newTracked.push(id);
      }
    }
    await this.setRotationState(this.isRotating, newTracked);
  }

  // --- Rebuild in-memory state from storage (on alarm wake) ---
  private async rebuildTabsFromState(): Promise<void> {
    if (this.tabsConfig && this.tabsConfig.tabs?.length) return; // already built

    try {
      const { loadedConfig } =
        await this.loadActualConfigurationFromLocalStorage();
      const tracked = [...new Set(this.rotationState.tabIds ?? [])];

      const tabsConfig = new TabsConfig();
      for (let i = 0; i < (loadedConfig.pages?.length ?? 0); i++) {
        const page = loadedConfig.pages[i];
        const cfg = new TabConfig({ page, active: i === 0 });
        const id = tracked[i];
        if (id) {
          const exists = await this.ensureTabExists(id);
          if (exists) {
            cfg.tabId = id;
            cfg.tabIdReady = true;
            tabsConfig.tabs.push(cfg);
            if (this.windowId == null) {
              try {
                const t = await chrome.tabs.get(id);
                if (t?.windowId != null) this.windowId = t.windowId;
              } catch {}
            }
            continue;
          }
        }
        // If missing, we can recreate lazily later. Push placeholder so indices align.
        tabsConfig.tabs.push(cfg);
      }

      this.tabsConfig = tabsConfig;
      // Small grace to avoid anti-spam cutting recreated tabs
      this.enforceResumeAt = Math.max(this.enforceResumeAt, Date.now() + 5000);
    } catch (e) {
      console.warn('[rotator] rebuildTabsFromState failed:', e);
    }
  }

  // Diagnostics
  public async getDiagnostics(): Promise<any> {
    const manifest = chrome.runtime.getManifest();
    const alarms = await chrome.alarms.getAll();
    let wndId = this.windowId;
    try {
      const wnd = await chrome.windows.getLastFocused();
      wndId = wnd?.id ?? wndId;
    } catch {}
    let tabs = [] as chrome.tabs.Tab[];
    try {
      tabs = await chrome.tabs.query(wndId ? { windowId: wndId } : {});
    } catch {}

    const allowed = new Set<number>();
    if (this.isRotating && this.tabsConfig?.tabs?.length) {
      for (const t of this.tabsConfig.tabs) {
        if (t.tabId > 0) allowed.add(t.tabId);
        if (t.nextTabId > 0) allowed.add(t.nextTabId);
      }
    }

    const tracked = [...new Set(this.rotationState.tabIds ?? [])];
    const extras = tracked.filter((id) => !allowed.has(id));

    return {
      version: manifest.version,
      isRotating: this.isRotating,
      currentIndex: this.currentIndex,
      pagesConfigured: this.tabsConfig?.tabs?.length ?? 0,
      lastRotationAt: this.isRotating ? this.lastRotationAt : null,
      nextRotationDueAt: this.isRotating ? this.nextRotationDueAt : null,
      lastRotationAgeSeconds: this.isRotating && this.lastRotationAt
        ? Math.round((Date.now() - this.lastRotationAt) / 1000)
        : null,
      lastFocusAttemptAt: this.lastFocusAttemptAt,
      lastFocusAttemptSource: this.lastFocusAttemptSource,
      lastFocusAttemptWindowId: this.lastFocusAttemptWindowId,
      lastFocusAttemptSucceeded: this.lastFocusAttemptSucceeded,
      lastFocusAttemptError: this.lastFocusAttemptError,
      trackedTabIds: tracked,
      allowedIds: [...allowed],
      extraTrackedIds: extras,
      windowId: wndId ?? null,
      windowTabCount: tabs.length,
      windowTabsPreview: tabs.slice(0, 15).map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        discarded: t.discarded,
      })),
      alarms: alarms.map((a) => ({
        name: a.name,
        scheduledTime: a.scheduledTime,
        periodInMinutes: a.periodInMinutes,
      })),
      enforceResumeAt: this.enforceResumeAt,
      now: Date.now(),
    };
  }

  // --- Focus helpers & diagnostics ---
  private recordFocusAttempt(source: string, windowId: number | null, success: boolean, error?: string) {
    this.lastFocusAttemptAt = Date.now();
    this.lastFocusAttemptSource = source;
    this.lastFocusAttemptWindowId = windowId;
    this.lastFocusAttemptSucceeded = success;
    this.lastFocusAttemptError = error ?? null;
  }

  private async attemptFocus(source: 'rotateTabs' | 'openNextPageTab', tabId: number): Promise<void> {
    if (this.currentConfig?.preventWindowFocus) {
      this.recordFocusAttempt(source, this.windowId ?? null, false, 'suppressed-by-config');
      return;
    }
    try {
      if (this.windowId == null) {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab?.windowId != null) this.windowId = tab.windowId;
        } catch (e) {
          // swallow; may fail if tab closed
        }
      }
      if (this.windowId != null) {
        try {
          await chrome.windows.update(this.windowId, { focused: true });
          this.recordFocusAttempt(source, this.windowId, true);
        } catch (focusErr) {
          this.recordFocusAttempt(source, this.windowId, false, String(focusErr));
        }
      } else {
        this.recordFocusAttempt(source, null, false, 'no-window-id');
      }
    } catch (outer) {
      this.recordFocusAttempt(source, this.windowId ?? null, false, String(outer));
    }
  }

  public async enforceNow(): Promise<any> {
    await this.enforceTabInvariant(true);
    return this.getDiagnostics();
  }

  // Force an immediate rotation attempt (used by diagnostics panel)
  public async forceRotateNow(): Promise<any> {
    if (!this.isRotating) {
      console.warn('[rotator] forceRotateNow called while not rotating. Attempting initialize.');
      try {
        await this.initialize();
      } catch (e) {
        console.error('[rotator] Failed to initialize during forceRotateNow', e);
        return { ok: false, error: String(e) };
      }
    } else {
      try {
        await this.rotateTabs();
      } catch (e) {
        console.error('[rotator] forceRotateNow rotate failed', e);
        return { ok: false, error: String(e) };
      }
    }
    try {
      const diags = await this.getDiagnostics();
      return { ok: true, diagnostics: diags };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
}
