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
import { ConfigService } from './config.service';
import { FocusService } from './focus.service';
import { TabManagerService } from './tab-manager.service';
import { DiagnosticsService } from './diagnostics.service';
import { StallGuardService } from './stall-guard.service';
import { SchedulerService } from './scheduler.service';
import { StorageService } from './storage.service';
import isEqual from 'lodash/isEqual';
import { safeRuntimeLastError } from '../shared';
import { MetricsService } from './metrics.service';
import { ActivationDiagnosticsService } from './activation-diagnostics.service';
import { CountdownService } from './countdown.service';
import { RotationStateRepository } from './rotation-state.repository';
import { HealthMonitorService } from './health-monitor.service';
import { FocusOrchestratorService } from './focus-orchestrator.service';
import { TabLifecycleService } from './tab-lifecycle.service';
import { InvariantRebuilderService } from './invariant-rebuilder.service';
import { ActivationService } from './activation.service';
import { RotationSchedulerService } from './rotation-scheduler.service';
import { StartupRecoveryService } from './startup-recovery.service';
import { RotationStateFacade } from './rotation-state.facade';
import { RotationWatchdogService } from './rotation-watchdog.service';

/**
 * RotationService (MV3-friendly)
 */
export class RotationService {
  private rotationState = new RotationState();
  private maxRetries = 1;
  private defaultFailedPageReloadIntervalSeconds = 120;

  private currentIndex = 0;
  private tabsConfig?: TabsConfig; // mirror of tabManager.tabsConfig once initialized
  private currentConfig?: ConfigData;
  private windowId?: number;

  // Guards
  private rotating = false;
  private starting = false;
  // Creation tracking & per-page cap enforced in TabManagerService; only minimal guard flags here.

  // Anti-spam: skip enforcement until this time (ms since epoch)
  private enforceResumeAt = 0;

  private static readonly ALARM_ROTATE = 'rotate';
  private static readonly ALARM_CONFIG = 'configReload';

  private stopping = false;
  // Diagnostics timestamps
  // Health tracking delegated to HealthMonitorService

  // Watchdog
  private static readonly ALARM_WATCHDOG = 'rotationWatchdog';
  private watchdogIntervalSeconds = 60; // check every 60s
  private watchdogGraceSeconds = 10; // grace after expected due time
  // Focus diagnostics
  private focusOrchestrator: FocusOrchestratorService;
  // Rotation diagnostics
  private lastActivatedTabId: number | null = null;
  private lastActivatedPageIndex: number | null = null;
  private rotationCycle: number = 0; // counts completed full cycles through all pages
  // Stall diagnostics
  private healthMonitor: HealthMonitorService = new HealthMonitorService();
  // Debug flags
  private debugActivationLogging = false;
  // Activation diagnostics service
  private activationDiagnostics: ActivationDiagnosticsService;
  private countdown: CountdownService;
  private rotationRepo: RotationStateRepository;
  private stateFacade!: RotationStateFacade;
  private tabLifecycle: TabLifecycleService;
  private invariantRebuilder: InvariantRebuilderService;
  private activationService: ActivationService;
  private rotationScheduler: RotationSchedulerService;
  private watchdogService!: RotationWatchdogService;
  public isStopping(): boolean {
    return this.stopping;
  }

  get isRotating(): boolean {
    return this.rotationState?.isRotating || false;
  }

  constructor(
    private http: CustomHttpClient,
    private configValidator: ConfigValidatorService,
    private toolbarManagerService: ToolbarManagerService,
    private configService: ConfigService = new ConfigService(
      http,
      configValidator
    ),
    private startupRecovery?: StartupRecoveryService,
    private focusService: FocusService = new FocusService(),
    private tabManager: TabManagerService = new TabManagerService(
      new MetricsService()
    ),
    private diagnosticsService: DiagnosticsService = new DiagnosticsService(),
    private stallGuard: StallGuardService = new StallGuardService(),
    private scheduler: SchedulerService = new SchedulerService(),
    private storage: StorageService = new StorageService(),
    private metrics: MetricsService = new MetricsService()
  ) {
    this.activationDiagnostics = new ActivationDiagnosticsService(this.storage);
    this.countdown = new CountdownService(this.activationDiagnostics);
    this.rotationRepo = new RotationStateRepository(this.storage);
    this.stateFacade = new RotationStateFacade(
      this.rotationRepo,
      this.toolbarManagerService,
      this.rotationState
    );
    // Lazily build invariantRebuilder before startupRecovery if needed
    this.invariantRebuilder = new InvariantRebuilderService(
      this.configService,
      this.tabManager
    );
    if (!this.startupRecovery) {
      this.startupRecovery = new StartupRecoveryService(
        this.rotationRepo,
        this.storage,
        this.configService,
        this.focusService,
        this.tabManager,
        this.scheduler,
        this.invariantRebuilder,
        this.healthMonitor,
        this.activationDiagnostics
      );
    }
    // Asynchronously restore prior state via StartupRecoveryService (non-blocking constructor)
    this.startupRecovery
      .restore({ windowId: this.windowId })
      .then((r) => {
        // IMPORTANT: Do NOT replace the rotationState object reference after the facade has been created.
        // stateFacade holds a captured reference to the original instance passed into its constructor.
        // Reassigning (this.rotationState = r.rotationState) causes a divergence: the RotationService getter
        // starts reading from the NEW object (with default isRotating=false) while the facade continues
        // mutating the OLD object. This led to a race where startRotationProcess() set rotating=true via
        // the facade, then the async restore() completed and overwrote this.rotationState with a fresh
        // instance whose isRotating=false, so rotateTabs() immediately aborted with
        // "rotate called while not rotating — ignoring." despite having just set rotation true.
        if (r?.rotationState) {
          const replaced = this.rotationState !== r.rotationState;
            // Merge properties onto existing instance to preserve identity.
          Object.assign(this.rotationState, r.rotationState);
          if (replaced && this.rotationState.isRotating) {
            // Optional debug log to surface that we merged a running state.
            console.debug('[rotator] startupRecovery: merged restored rotationState (preserved identity).');
          }
        }
        if (typeof r?.currentIndex === 'number')
          this.currentIndex = r.currentIndex;
        if (typeof (r as any)?.debugActivationLogging === 'boolean')
          this.debugActivationLogging = (r as any).debugActivationLogging;
        // Adopt ownership of previously tracked tabs so we never close user tabs accidentally if they still exist.
        try { this.tabManager.adoptOwnership(this.rotationState.tabIds); } catch {}
        // If state says we were rotating but no tabsConfig is built yet, rely on normal initialize to recreate.
        if (this.rotationState.isRotating && (!this.tabsConfig || !this.tabsConfig.tabs.length)) {
          // Schedule async initialize (don't block constructor) so config-driven creation runs through standard path.
          Promise.resolve().then(()=> this.initialize().catch(e=> console.warn('[rotator] auto-initialize after restore failed', e)));
        }
      })
      .catch((e) =>
        console.warn('[rotator] startupRecovery.restore failed', e)
      );
    this.tabLifecycle = new TabLifecycleService(
      this.tabManager,
      this.scheduler,
      this.metrics
    );
    this.focusOrchestrator = new FocusOrchestratorService(
      this.focusService,
      this.metrics
    );
    this.activationService = new ActivationService({
      diagnostics: this.activationDiagnostics,
      focusOrchestrator: this.focusOrchestrator,
      debugFlagProvider: () => this.debugActivationLogging,
      onActivated: ({ tabId, pageIndex }) => {
        this.lastActivatedTabId = tabId;
        this.lastActivatedPageIndex = pageIndex;
      },
    });
    this.rotationScheduler = new RotationSchedulerService(
      this.scheduler,
      this.healthMonitor,
      this.countdown,
      this.activationDiagnostics
    );
    this.watchdogService = new RotationWatchdogService(
      this.healthMonitor,
      this.scheduler,
      {
        intervalSeconds: this.watchdogIntervalSeconds,
        graceSeconds: this.watchdogGraceSeconds,
      }
    );
  }

  // rescheduleIfNeeded now handled by StartupRecoveryService.rescheduleIfNeeded
  public async rescheduleIfNeeded(): Promise<void> {
    const result = await this.startupRecovery?.rescheduleIfNeeded(this.rotationState, {
      value: this.currentIndex,
    });
    if (result?.reinitNeeded) {
      if (this.debugActivationLogging) console.debug('[rotator] reschedule indicates missing tabs — reinitializing.');
      try { await this.initialize(); } catch (e) { console.error('[rotator] auto-initialize after reschedule failed', e); }
    }
  }

  /**
   * Initialize (or re-initialize) rotation.
   * By default a re-initialize while already rotating performs a full stopRotation(),
   * which removes all owned tabs before creating a fresh set. During an MV3 service
   * worker restart ("crash" from the user perspective) we instead want to KEEP the
   * existing rotation tabs and simply rebuild in-memory state & scheduling so the
   * user's pages are not closed.
   *
   * Passing opts.preserveExisting=true skips the destructive stopRotation() path
   * and attempts to reuse / adopt currently tracked tabs.
   */
  async initialize(opts?: { preserveExisting?: boolean }): Promise<void> {
    if (this.starting) {
      console.info('[rotator] initialize already in progress; skipping.');
      return;
    }
    this.starting = true;
    try {
      console.log('[rotator] initialize');

      // Clear alarms from any previous run
      await this.scheduler.clear(RotationService.ALARM_ROTATE);
      await this.scheduler.clear(RotationService.ALARM_CONFIG);
      await this.scheduler.clear(RotationService.ALARM_WATCHDOG);
      // Clear all leftover reload:* alarms via scheduler helper
      await this.scheduler.clearAllReloads();

      const preserve = !!opts?.preserveExisting;
      if (this.isRotating && !preserve) {
        await this.stopRotation();
      } else if (this.isRotating && preserve) {
        // Rebuild in-memory structures for existing tabs (created before SW restart)
        await this.tryRebuildTabs();
        // Keep rotationState.tabIds as-is; just clear alarms & continue.
        if (this.debugActivationLogging) console.debug('[rotator] preserveExisting: reusing existing rotation tabs:', this.rotationState.tabIds);
      }

      try {
        const wnd = await chrome.windows.getLastFocused();
        this.windowId = wnd?.id;
      } catch (e) {
        console.warn('[rotator] getLastFocused failed', e);
      }

      this.enforceResumeAt = Date.now() + 15000; // 15s grace

      const { loadedConfig, loadedRemoteSettings } =
        await this.configService.loadFromStorage();
      this.currentConfig = loadedConfig;
      this.focusService.setConfig(this.currentConfig);

      const startRotation = async (config: ConfigData) => {
        if (!config?.pages || config.pages.length === 0) {
          console.warn(
            '[rotator] No pages configured — not starting rotation.'
          );
          await this.stateFacade.set({
            rotating: false,
            currentIndex: this.currentIndex,
            tabsConfig: this.tabsConfig,
            tabIds: this.rotationState.tabIds,
            lastActivatedPageIndex: this.lastActivatedPageIndex,
            lastActivatedTabId: this.lastActivatedTabId,
            rotationCycle: this.rotationCycle,
          });
          return;
        }
        const reuseExistingTabs = preserve && this.isRotating && (this.rotationState.tabIds?.length || 0) > 0;
        if (!reuseExistingTabs) {
          await this.stateFacade.set({
            rotating: true,
            currentIndex: this.currentIndex,
            tabsConfig: this.tabsConfig,
            tabIds: this.rotationState.tabIds,
            lastActivatedPageIndex: this.lastActivatedPageIndex,
            lastActivatedTabId: this.lastActivatedTabId,
            rotationCycle: this.rotationCycle,
          });
          await this.createTabs(config);
          // Remove any session-restored duplicate tabs matching rotation pages that are not part of current tracking set.
          await this.prunePreexistingRotationTabs(config);
        } else {
          // Existing tabs are retained; ensure tabsConfig is rebuilt for them if needed.
          if (!this.tabsConfig || !this.tabsConfig.tabs.length) {
            await this.tryRebuildTabs();
          }
          await this.stateFacade.set({
            rotating: true,
            currentIndex: this.currentIndex,
            tabsConfig: this.tabsConfig,
            tabIds: this.rotationState.tabIds,
            lastActivatedPageIndex: this.lastActivatedPageIndex,
            lastActivatedTabId: this.lastActivatedTabId,
            rotationCycle: this.rotationCycle,
          });
        }
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
            const remoteConfig = await this.configService.fetchRemoteConfig(
              loadedRemoteSettings.configUrl!
            );
            if (remoteConfig && !isEqual(this.currentConfig, remoteConfig)) {
              await this.storage.set({
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
                await this.stateFacade.set({
                  rotating: false,
                  currentIndex: this.currentIndex,
                  tabsConfig: this.tabsConfig,
                  tabIds: this.rotationState.tabIds,
                  lastActivatedPageIndex: this.lastActivatedPageIndex,
                  lastActivatedTabId: this.lastActivatedTabId,
                  rotationCycle: this.rotationCycle,
                });
              }
            }
          } catch (error) {
            console.error(
              '[rotator] Failed to load remote configuration:',
              error
            );
            // Fall back to last saved config if present
            if (!this.isRotating) {
              if (loadedConfig?.pages?.length)
                await startRotation(loadedConfig);
              else {
                await this.stateFacade.set({
                  rotating: false,
                  currentIndex: this.currentIndex,
                  tabsConfig: this.tabsConfig,
                  tabIds: this.rotationState.tabIds,
                  lastActivatedPageIndex: this.lastActivatedPageIndex,
                  lastActivatedTabId: this.lastActivatedTabId,
                  rotationCycle: this.rotationCycle,
                });
              }
            }
          }
        };

        await loadAndStartRotation();
        await this.scheduler.create(RotationService.ALARM_CONFIG, {
          periodInMinutes: loadedRemoteSettings.configReloadIntervalMinutes,
        });
      }
      // Start watchdog after initialization
      await this.scheduler.create(RotationService.ALARM_WATCHDOG, {
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
    await this.focusOrchestrator.tryFullscreen(
      configData,
      this.tabsConfig,
      (winId) => {
        this.windowId = winId;
      }
    );
  }

  private async startRotationProcess(configData: ConfigData): Promise<void> {
    console.log('[rotator] Start rotation process');
    try {
      await this.stateFacade.set({
        rotating: true,
        tabIds: this.tabsConfig?.tabs.map((t) => t.tabId),
        tabsConfig: this.tabsConfig,
        currentIndex: this.currentIndex,
        lastActivatedPageIndex: this.lastActivatedPageIndex,
        lastActivatedTabId: this.lastActivatedTabId,
        rotationCycle: this.rotationCycle,
      });
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
      // Clear countdown via service & reset badge/storage
      try {
        this.countdown.stop();
        chrome.action.setBadgeText({ text: '' });
        chrome.storage.local.remove('__countdown');
      } catch {}

      if (this.tabManager.tabsConfig?.tabs?.length) {
        for (const t of this.tabManager.tabsConfig.tabs) {
          this.clearReloadAlarmForTab(t.tabId);
          this.clearReloadAlarmForTab(t.nextTabId);
        }
      }

      await this.tabManager.removeTabs(this.rotationState?.tabIds || []);
      await this.stateFacade.set({
        rotating: false,
        tabIds: [],
        tabsConfig: this.tabsConfig,
        currentIndex: 0,
        lastActivatedPageIndex: this.lastActivatedPageIndex,
        lastActivatedTabId: this.lastActivatedTabId,
        rotationCycle: this.rotationCycle,
      });
      this.currentIndex = 0;
      await this.stateFacade.updateIndex(this.currentIndex);
      this.tabManager.tabsConfig = new TabsConfig();
      this.tabsConfig = this.tabManager.tabsConfig;
      // Reset timing expectations
      this.healthMonitor.clearSchedule();
    } catch (error) {
      console.error('[rotator] Failed to stop rotation:', error);
      throw error;
    } finally {
      this.stopping = false;
    }
  }

  async tryRemoveTabFromRotationOnClose(tabId: number): Promise<void> {
    if (this.stopping) return; // silence removal noise

    const tabConfig = this.tabManager.tabsConfig?.tabs?.find(
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
    await this.stateFacade.set({
      rotating: this.isRotating,
      tabIds: this.rotationState.tabIds?.filter((id) => id !== tabId),
      tabsConfig: this.tabsConfig,
      currentIndex: this.currentIndex,
      lastActivatedPageIndex: this.lastActivatedPageIndex,
      lastActivatedTabId: this.lastActivatedTabId,
      rotationCycle: this.rotationCycle,
    });
  }

  async onPageLoaded(tabId: number, url: string): Promise<void> {
    const tabConfig = this.tabManager.tabsConfig?.tabs?.find(
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
    await this.enforceInvariant();

    if (tabConfig.page.reloadIntervalSeconds > 0) {
      const targetId =
        tabConfig.nextTabId > 0 ? tabConfig.nextTabId : tabConfig.tabId;
      this.scheduleReloadAlarm(targetId, tabConfig.page.reloadIntervalSeconds);
    }
  }

  async onHandleError(tabId: number, errorUrl: string): Promise<void> {
    const tabConfig = this.tabManager.tabsConfig?.tabs?.find(
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
    await this.tryRebuildTabs();
    const stored = await this.storage.get<any>(StorageKeys.RotationState);
    if (stored && typeof stored.currentIndex === 'number') {
      const len = this.tabsConfig?.tabs.length || 1;
      this.currentIndex = len > 0 ? stored.currentIndex % len : 0;
    }
    if (this.debugActivationLogging) {
      console.debug('[rotator][alarm] rotate alarm fired', {
        storedCurrentIndex: stored?.currentIndex,
        inMemoryCurrentIndex: this.currentIndex,
        tabCount: this.tabsConfig?.tabs?.length,
      });
    }
    await this.rotateTabs();
  }

  public async onWatchdogAlarm(): Promise<void> {
    await this.watchdogService.handleAlarm(this);
  }

  public async onConfigReloadAlarm(): Promise<void> {
    try {
      const useRemote = (await this.storage.get<boolean>(
        StorageKeys.UseRemoteConfig
      )) as boolean;
      if (!useRemote) return;

      const rs = await this.storage.get<RemoteSettings>(
        StorageKeys.RemoteSettings
      );
      if (!rs?.configUrl) return;

      const remoteConfig = await this.configService.fetchRemoteConfig(
        rs.configUrl
      );
      if (remoteConfig && !isEqual(this.currentConfig, remoteConfig)) {
        await this.storage.set({ [StorageKeys.RemoteConfig]: remoteConfig });
        console.info('[rotator] Remote config updated via alarm.');

        if (this.isRotating) {
          await this.stopRotation();
        }
        await this.stateFacade.set({
          rotating: true,
          currentIndex: this.currentIndex,
          tabsConfig: this.tabsConfig,
          tabIds: this.rotationState.tabIds,
          lastActivatedPageIndex: this.lastActivatedPageIndex,
          lastActivatedTabId: this.lastActivatedTabId,
          rotationCycle: this.rotationCycle,
        });
        await this.createTabs(remoteConfig);
        await this.tryFullscreen(remoteConfig);
        await this.startRotationProcess(remoteConfig);
      }
    } catch (e) {
      console.error(
        '[rotator] onConfigReloadAlarm error:',
        e,
        safeRuntimeLastError()
      );
    }
  }

  public async onReloadAlarm(tabId: number): Promise<void> {
    await this.tryRebuildTabs();
    const tabConfig = this.tabsConfig?.tabs?.find(
      (t) => t.tabId === tabId || t.nextTabId === tabId
    );
    if (!tabConfig) return;
    try {
      await this.tabLifecycle.handleReloadAlarm(
        tabId,
        this.tabsConfig,
        async (tc: TabConfig) => {
          await this.createTab(tc);
        },
        async (tabIds: number[]) => {
          await this.stateFacade.set({
            rotating: this.rotationState.isRotating,
            tabIds,
            tabsConfig: this.tabsConfig,
            currentIndex: this.currentIndex,
            lastActivatedPageIndex: this.lastActivatedPageIndex,
            lastActivatedTabId: this.lastActivatedTabId,
            rotationCycle: this.rotationCycle,
          });
        },
        async () => {
          await this.enforceInvariant();
        }
      );
    } catch (error) {
      console.error(
        '[rotator] Error in onReloadAlarm:',
        error,
        safeRuntimeLastError()
      );
    }
  }

  private clearReloadAlarmForTab(tabId?: number) {
    if (tabId && tabId > 0) this.scheduler.clearReload(tabId);
  }
  private scheduleReloadAlarm(tabId: number, seconds: number) {
    this.tabLifecycle.scheduleReloadAlarm(tabId, seconds);
  }

  private async rotateTabs(): Promise<void> {
    if (this.rotating) {
      console.info('[rotator] rotate: already running; skip.');
      return;
    }
    this.rotating = true;
    try {
      // Heartbeat write (fast non-blocking fire & forget) to signal liveness before heavy work
      try {
        await this.storage.set({ [StorageKeys.RotationHeartbeat]: Date.now() });
      } catch {}
      let beforeActive: chrome.tabs.Tab | undefined;
      try {
        const winId = this.windowId;
        const act = await chrome.tabs.query(
          winId != null
            ? { windowId: winId, active: true }
            : { active: true, currentWindow: true }
        );
        beforeActive = act?.[0];
      } catch {}
      // Defensive: validate rotation conditions
      if (!this.isRotating) {
        console.warn('[rotator] rotate called while not rotating — ignoring.');
        return;
      }
      const tabCount = this.tabsConfig?.tabs?.length || 0;
      if (!this.tabsConfig || tabCount === 0) {
        console.warn('[rotator] No tabs configured yet.');
        await this.stateFacade.set({
          rotating: false,
          currentIndex: this.currentIndex,
          tabsConfig: this.tabsConfig,
          tabIds: this.rotationState.tabIds,
          lastActivatedPageIndex: this.lastActivatedPageIndex,
          lastActivatedTabId: this.lastActivatedTabId,
          rotationCycle: this.rotationCycle,
        });
        return;
      }
      if (this.currentIndex < 0 || this.currentIndex >= tabCount) {
        console.warn(
          '[rotator] currentIndex out of range; resetting to 0',
          this.currentIndex,
          tabCount
        );
        this.currentIndex = 0;
        await this.stateFacade.updateIndex(this.currentIndex);
      }

      const currentTab = this.tabsConfig.tabs[this.currentIndex];
      if (!currentTab) {
        console.warn(
          '[rotator] No current tab (index=%d) — scheduling retry in 5s',
          this.currentIndex
        );
        await this.scheduler.clear(RotationService.ALARM_ROTATE);
        await this.scheduler.scheduleIn(RotationService.ALARM_ROTATE, 5000);
        return;
      }
      // Lazy materialization: after MV3 service worker restart or tab closure we may have a placeholder with no tabId.
      // Previous implementation never recreated these, causing perpetual activation failure at the same index.
      if (!(currentTab.tabId > 0 || currentTab.nextTabId > 0)) {
        try {
          if (this.debugActivationLogging) {
            console.debug(
              '[rotator] Placeholder detected for index=%d – creating tab now.',
              this.currentIndex
            );
          }
          await this.createTab(currentTab);
          // Wait briefly for load flag (non-blocking of whole rotation cycle but improves first activation reliability)
          try {
            await this.tabLifecycle.waitForInitialLoad(currentTab);
          } catch {}
          if (this.debugActivationLogging) {
            console.debug('[rotator] Placeholder creation result', {
              index: this.currentIndex,
              tabId: currentTab.tabId,
              nextTabId: currentTab.nextTabId,
              ready: { p: currentTab.tabIdReady, n: currentTab.nextTabIdReady },
            });
          }
        } catch (e) {
          console.error(
            '[rotator] Failed to create placeholder tab at index',
            this.currentIndex,
            e
          );
        }
      }
      if (this.debugActivationLogging) {
        console.debug(
          '[rotator] Rotating to index=%d of %d (tabId=%d nextTabId=%d)',
          this.currentIndex,
          tabCount,
          currentTab.tabId,
          currentTab.nextTabId
        );
      }

      let activatedIndex: number | null = null;
      if (currentTab.nextTabId > 0 && currentTab.nextTabIdReady) {
        await this.openNextPageTab(currentTab);
        activatedIndex = this.lastActivatedPageIndex;
      } else {
        const targetId =
          currentTab.tabId > 0 ? currentTab.tabId : currentTab.nextTabId;
        if (targetId > 0) {
          const ok = await this.activationService.activateTabWithFallback(
            targetId,
            this.currentIndex,
            'rotateTabs'
          );
          if (ok) {
            activatedIndex = this.currentIndex;
          }
        }
      }
      try {
        const winId2 = this.windowId;
        const act2 = await chrome.tabs.query(
          winId2 != null
            ? { windowId: winId2, active: true }
            : { active: true, currentWindow: true }
        );
        const afterActive = act2?.[0];
        if (this.debugActivationLogging) {
          console.debug('[rotator] Active tab before/after rotate', {
            before: beforeActive
              ? { id: beforeActive.id, url: beforeActive.url }
              : null,
            after: afterActive
              ? { id: afterActive.id, url: afterActive.url }
              : null,
            expectedIndex: this.currentIndex,
            lastActivatedPageIndex: this.lastActivatedPageIndex,
            lastActivatedTabId: this.lastActivatedTabId,
          });
          this.debugSnapshot('post-rotate');
        }
      } catch {}

      // If we failed to activate any tab (no valid target ID yet), don't advance index.
      if (activatedIndex == null) {
        if (this.debugActivationLogging) {
          console.warn(
            '[rotator] Activation skipped/failed for index=%d (tabId=%d nextTabId=%d ready=%s/%s). Retrying in 2s without advancing index.',
            this.currentIndex,
            currentTab?.tabId,
            currentTab?.nextTabId,
            currentTab?.tabIdReady,
            currentTab?.nextTabIdReady
          );
        }
        try {
          await this.scheduler.clear(RotationService.ALARM_ROTATE);
          await this.scheduler.scheduleIn(RotationService.ALARM_ROTATE, 2000);
        } catch (e) {
          console.error(
            '[rotator] Failed to schedule retry after activation miss',
            e
          );
        }
        return; // ensure we do not call scheduleNextRotation() below
      }
      const delaySeconds = Math.max(
        1,
        Number(currentTab.page?.delaySeconds) || 1
      );
      const sched = await this.rotationScheduler.scheduleNext({
        currentIndex: this.currentIndex,
        tabCount,
        delaySeconds,
        tabsConfig: this.tabsConfig,
      });
      this.currentIndex = sched.nextIndex;
      if (this.currentIndex === 0) this.rotationCycle++;
      await this.stateFacade.updateIndex(this.currentIndex);
      this.metrics.recordRotation({ index: this.currentIndex, delaySeconds });
      // Delegate stall detection to StallGuardService
      const postTabCount = this.tabsConfig?.tabs?.length || 0;
      const rotateSnap = this.healthMonitor.snapshot();
      const stallReset = this.stallGuard.evaluateRotation({
        activatedIndex,
        tabCount: postTabCount,
        lastRotationAt: rotateSnap.lastRotationAt,
        delaySeconds,
        lastActivatedPageIndex: this.lastActivatedPageIndex,
      });
      if (stallReset) {
        this.healthMonitor.adoptStallState({
          stallCount: this.stallGuard.state.stallCount,
          lastStallAt: this.stallGuard.state.lastStallAt,
          lastStallReason: this.stallGuard.state.lastStallReason,
        });
        if (this.debugActivationLogging) {
          console.warn(
            '[rotator] Stall detected (delegated) — forcing realignment.'
          );
        }
        const snap2 = this.healthMonitor.snapshot();
        this.metrics.recordStall(snap2.lastStallReason || 'stuck');
        this.currentIndex = 0;
        await this.stateFacade.updateIndex(this.currentIndex);
        await this.scheduler.clear(RotationService.ALARM_ROTATE);
        await this.scheduler.scheduleIn(RotationService.ALARM_ROTATE, 1000);
      }
      // Light periodic cleanup of stale tracked IDs (non-force respects grace window)
      try {
        await this.enforceInvariant();
      } catch {}
    } finally {
      this.rotating = false;
    }
  }

  /**
   * Attempts to activate a tab robustly.
   * 1. chrome.tabs.update({active:true})
   * 2. Verify by querying active tab in the same window.
   * 3. Fallback to chrome.tabs.highlight if still not active.
   * 4. Retry once after a short delay.
   * Returns true if activation confirmed, else false.
   */

  private debugSnapshot(tag: string) {
    if (!this.debugActivationLogging) return;
    try {
      const pages =
        this.tabsConfig?.tabs?.map((t, i) => ({
          i,
          tabId: t.tabId,
          nextTabId: t.nextTabId,
          ready: { p: t.tabIdReady, n: t.nextTabIdReady },
          delay: t.page?.delaySeconds,
          url: t.page?.url?.slice(0, 80),
        })) || [];
      console.debug('[rotator][snapshot]', tag, {
        currentIndex: this.currentIndex,
        lastActivatedPageIndex: this.lastActivatedPageIndex,
        lastActivatedTabId: this.lastActivatedTabId,
        rotationCycle: this.rotationCycle,
        pages,
      });
    } catch {}
  }

  private async openNextPageTab(tabConfig: TabConfig): Promise<void> {
    if (!(tabConfig.nextTabId > 0)) {
      console.error('[rotator] Next page tab ID is not defined.', tabConfig);
      return;
    }
    try {
      console.debug(
        '[rotator][openNext] activating nextTabId=%d (primary=%d ready=%s/%s)',
        tabConfig.nextTabId,
        tabConfig.tabId,
        tabConfig.tabIdReady,
        tabConfig.nextTabIdReady
      );
      await chrome.tabs.update(tabConfig.nextTabId, { active: true });
      await this.attemptFocus('openNextPageTab', tabConfig.nextTabId);
      const tabIdToRemove = tabConfig.tabId;
      this.clearReloadAlarmForTab(tabIdToRemove);
      await this.tabManager.removeTabs([tabIdToRemove]);
      await this.stateFacade.set({
        rotating: this.isRotating,
        tabIds: this.rotationState.tabIds?.filter((id) => id !== tabIdToRemove),
        tabsConfig: this.tabsConfig,
        currentIndex: this.currentIndex,
        lastActivatedPageIndex: this.lastActivatedPageIndex,
        lastActivatedTabId: this.lastActivatedTabId,
        rotationCycle: this.rotationCycle,
      });

      tabConfig.tabId = tabConfig.nextTabId;
      tabConfig.nextTabId = 0;
      tabConfig.tabIdReady = true;
      tabConfig.nextTabIdReady = false;
      console.log('[rotator] Switched to next page tab', tabConfig.tabId);
      console.debug('[rotator][openNext] post-switch state', {
        idx: this.tabsConfig?.tabs.indexOf(tabConfig),
        lastActivatedPageIndex: this.lastActivatedPageIndex,
        lastActivatedTabId: this.lastActivatedTabId,
      });
      this.lastActivatedTabId = tabConfig.tabId;
      // lastActivatedPageIndex remains the index of tabConfig within tabsConfig
      if (this.tabsConfig?.tabs?.length) {
        const idx = this.tabsConfig.tabs.indexOf(tabConfig);
        if (idx >= 0) this.lastActivatedPageIndex = idx;
      }
    } catch (error) {
      console.error('[rotator] Error in open next page tab:', error);
    }
  }

  // loadActualConfigurationFromLocalStorage now delegated to ConfigService.loadFromStorage

  private async createTab(tabConfig: TabConfig): Promise<TabConfig> {
    return this.tabLifecycle.createPrimaryTab(tabConfig, async (cfg) => {
      const ids = new Set<number>(this.rotationState.tabIds ?? []);
      if (cfg.tabId) ids.add(cfg.tabId);
      if (cfg.nextTabId) ids.add(cfg.nextTabId);
      await this.stateFacade.set({
        rotating: this.rotationState.isRotating,
        tabIds: [...ids],
        tabsConfig: this.tabsConfig,
        currentIndex: this.currentIndex,
        lastActivatedPageIndex: this.lastActivatedPageIndex,
        lastActivatedTabId: this.lastActivatedTabId,
        rotationCycle: this.rotationCycle,
      });
      if (this.windowId == null && this.tabManager.window != null)
        this.windowId = this.tabManager.window;
    });
  }

  private async createTabs(configData: ConfigData): Promise<void> {
    console.log('[rotator] Creating tabs:', configData);
    if (!configData?.pages?.length) return;
    await this.tabManager.createTabs(
      configData,
      async (id: number) => {
        const ids = new Set<number>(this.rotationState.tabIds ?? []);
        ids.add(id);
        await this.stateFacade.set({
          rotating: this.rotationState.isRotating,
          tabIds: [...ids],
          tabsConfig: this.tabsConfig,
          currentIndex: this.currentIndex,
          lastActivatedPageIndex: this.lastActivatedPageIndex,
          lastActivatedTabId: this.lastActivatedTabId,
          rotationCycle: this.rotationCycle,
        });
      },
      async (t: TabConfig) => await this.tabLifecycle.waitForInitialLoad(t)
    );
    this.tabsConfig = this.tabManager.tabsConfig;
    if (this.windowId == null && this.tabManager.window != null)
      this.windowId = this.tabManager.window;
  }

  /**
   * After a full browser (or OS) restart Chrome may session-restore previously active tabs
   * (including one that belonged to the prior rotation cycle). Our rotation cycle should start
   * from a clean slate of newly created tabs so delays and reload timers are aligned.
   * This method scans currently open tabs; if a tab URL matches any configured rotation page URL
   * BUT its ID is not part of the tracked ownership (tabManager.tabsConfig or rotationState.tabIds)
   * we treat it as a session-restored duplicate and remove it.
   */
  private async prunePreexistingRotationTabs(config: ConfigData): Promise<void> {
    try {
      if (!config?.pages?.length) return;
      const pageUrls = new Set<string>(config.pages.map(p => p.url).filter(Boolean));
      if (!pageUrls.size) return;
      const trackedIds = new Set<number>();
      try {
        // Only consider tabs just created in this initialize cycle; ignore previously persisted IDs.
        for (const t of this.tabManager.tabsConfig?.tabs || []) {
          if (t.tabId > 0) trackedIds.add(t.tabId);
          if (t.nextTabId > 0) trackedIds.add(t.nextTabId);
        }
      } catch {}
      const existing = await chrome.tabs.query({});
      const toRemove: number[] = [];
      for (const t of existing) {
        if (!t || !t.id || !t.url) continue;
        if (pageUrls.has(t.url) && !trackedIds.has(t.id)) {
          toRemove.push(t.id);
        }
      }
      if (toRemove.length) {
        console.debug('[rotator] Pruning session-restored rotation tabs', toRemove);
        try { await chrome.tabs.remove(toRemove); } catch (e) { console.warn('[rotator] prune removal failed', e); }
      }
    } catch (e) {
      console.warn('[rotator] prunePreexistingRotationTabs failed', e);
    }
  }

  private removeReloadTimer(tabConfig: TabConfig) {
    tabConfig.retryCount = 0;
    const targetId =
      tabConfig.nextTabId > 0 ? tabConfig.nextTabId : tabConfig.tabId;
    this.clearReloadAlarmForTab(targetId);
  }

  // Diagnostics
  public async getDiagnostics(): Promise<any> {
    const healthSnap = this.healthMonitor.snapshot();
    const compositeBadgeColor = this.healthMonitor.computeCompositeBadgeColor();
    let preservedResumeAt: number | undefined;
    try { preservedResumeAt = await this.storage.get<number>(StorageKeys.PreservedResumeAt); } catch {}
    let heartbeatAt: number | undefined;
    try { heartbeatAt = await this.storage.get<number>(StorageKeys.RotationHeartbeat); } catch {}
    let preserveMaxAge: number | undefined;
    try { preserveMaxAge = await this.storage.get<number>(StorageKeys.PreserveHeartbeatMaxAgeSeconds); } catch {}
    let lastDecision: any = undefined;
    try { lastDecision = (chrome.runtime as any).__lastPreserveDecision; } catch {}
    return this.diagnosticsService.assembleDiagnostics({
      tabs: this.tabsConfig?.tabs,
      isRotating: this.isRotating,
      currentIndex: this.currentIndex,
      rotation: {
        lastRotationAt: healthSnap.lastRotationAt,
        nextRotationDueAt: healthSnap.nextRotationDueAt,
        lastActivatedTabId: this.lastActivatedTabId,
        lastActivatedPageIndex: this.lastActivatedPageIndex,
        rotationCycle: this.rotationCycle,
        stallCount: healthSnap.stallCount,
        lastStallAt: healthSnap.lastStallAt,
        lastStallReason: healthSnap.lastStallReason,
        severity: healthSnap.severity,
        badgeColor: compositeBadgeColor,
        preservedResumeAt,
        heartbeatAt,
        preserveMaxAgeSeconds: preserveMaxAge,
        lastPreserveDecision: lastDecision,
      },
      focus: this.focusOrchestrator.lastAttempt,
      rotationStateTabIds: this.rotationState.tabIds ?? [],
      windowId: this.windowId,
      enforceResumeAt: this.enforceResumeAt,
      // Provide activation error as a counter & will also be surfaced explicitly below
      metricsCounters: this.activationDiagnostics.getLastError()
        ? { lastActivationError: 1 }
        : undefined,
      activationHistory: this.activationDiagnostics.getHistory(),
      lastActivationSuccessAt: this.activationDiagnostics.getLastSuccessAt(),
    });
  }

  // Exposed for background message handlers
  public async clearActivationHistory() {
    await this.activationDiagnostics.clearHistory();
  }
  public clearActivationError() {
    this.activationDiagnostics.clearError();
  }

  // --- Focus helpers & diagnostics ---
  private async attemptFocus(
    source: 'rotateTabs' | 'openNextPageTab',
    tabId: number
  ): Promise<void> {
    await this.focusOrchestrator.attemptTabFocus(source, tabId, (win) => {
      if (this.windowId == null) this.windowId = win;
    });
  }

  public async enforceNow(): Promise<any> {
    await this.enforceInvariant(true);
    return this.getDiagnostics();
  }

  // Force an immediate rotation attempt (used by diagnostics panel)
  public async forceRotateNow(): Promise<any> {
    if (!this.isRotating) {
      console.warn(
        '[rotator] forceRotateNow called while not rotating. Attempting initialize.'
      );
      try {
        await this.initialize();
      } catch (e) {
        console.error(
          '[rotator] Failed to initialize during forceRotateNow',
          e
        );
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
  /**
   * Rebuilds in-memory tabsConfig after a service worker restart if it is not yet populated.
   * Idempotent: returns quickly when a valid tabsConfig already exists.
   */
  private async tryRebuildTabs(): Promise<void> {
    try {
      const result = await this.invariantRebuilder.rebuildTabsFromState({
        rotationTrackedIds: this.rotationState.tabIds,
        existingTabsConfig: this.tabsConfig,
        currentWindowId: this.windowId,
      });
      if (result) {
        this.tabsConfig = result.tabsConfig;
        this.windowId = result.windowId ?? this.windowId;
        this.enforceResumeAt = Math.max(
          this.enforceResumeAt,
          result.enforceResumeAt
        );
        this.currentConfig = result.loadedConfig;
        this.focusService.setConfig(this.currentConfig);
      }
    } catch (e) {
      console.warn('[rotator] tryRebuildTabs failed:', e);
    }
  }
  /**
   * Ensures tab invariants (tracked IDs alignment, pruning, ordering). When force=true
   * skips grace period checks and performs an immediate full enforcement.
   */
  private async enforceInvariant(force = false) {
    try {
      const updated = await this.invariantRebuilder.enforceInvariant({
        force,
        resumeAt: this.enforceResumeAt,
        trackedIds: this.rotationState.tabIds ?? [],
        tabManager: this.tabManager,
        tabsConfig: this.tabsConfig,
      });
      await this.stateFacade.set({
        rotating: this.isRotating,
        tabIds: updated,
        tabsConfig: this.tabsConfig,
        currentIndex: this.currentIndex,
        lastActivatedPageIndex: this.lastActivatedPageIndex,
        lastActivatedTabId: this.lastActivatedTabId,
        rotationCycle: this.rotationCycle,
      });
    } catch (e) {
      if (this.debugActivationLogging)
        console.debug('[rotator] enforceInvariant skipped', e);
    }
  }
}
