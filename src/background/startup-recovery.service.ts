import { RotationState, StorageKeys, RemoteSettings } from '../app/models';
import { RotationStateRepository } from './rotation-state.repository';
import { ConfigService } from './config.service';
import { FocusService } from './focus.service';
import { TabManagerService } from './tab-manager.service';
import { SchedulerService } from './scheduler.service';
import { StorageService } from './storage.service';
import { InvariantRebuilderService } from './invariant-rebuilder.service';
import { HealthMonitorService } from './health-monitor.service';
import { ActivationDiagnosticsService } from './activation-diagnostics.service';
import { safeRuntimeLastError } from '../shared';
import isEqual from 'lodash/isEqual';

export interface RestoreResult {
  rotationState: RotationState;
  currentIndex: number;
  debugActivationLogging: boolean;
  windowId?: number;
}

export class StartupRecoveryService {
  constructor(
    private rotationRepo: RotationStateRepository,
    private storage: StorageService,
    private configService: ConfigService,
    private focusService: FocusService,
    private tabManager: TabManagerService,
    private scheduler: SchedulerService,
    private invariantRebuilder: InvariantRebuilderService,
    private healthMonitor: HealthMonitorService,
    private activationDiagnostics: ActivationDiagnosticsService
  ) {}

  /** Restores rotation state and attempts in-memory rebuild (idempotent). */
  public async restore(windowIdRef: { windowId?: number }): Promise<RestoreResult> {
    console.log('[startup] Restore previous rotation state.');
    const { state: storedState, currentIndex } = await this.rotationRepo.load();
    let debugFlag = false;
    try { debugFlag = !!(await this.storage.get(StorageKeys.DebugActivationLogging)); } catch {}
    await this.activationDiagnostics.init();
    try {
      this.healthMonitor.attachActivationMetrics(() => ({
        lastSuccessAt: this.activationDiagnostics.getLastSuccessAt() || null,
        recentHistory: this.activationDiagnostics.getHistory().slice(-10).map(h => ({ success: h.success, at: h.at }))
      }));
    } catch {}
    const rotationState = storedState || new RotationState();
    const idx = Number(currentIndex ?? 0);
    try {
      await this.invariantRebuilder.rebuildTabsFromState({
        rotationTrackedIds: rotationState.tabIds,
        existingTabsConfig: this.tabManager.tabsConfig,
        currentWindowId: windowIdRef.windowId,
      }).then(result => {
        if (result) {
          this.tabManager.tabsConfig = result.tabsConfig;
          windowIdRef.windowId = result.windowId ?? windowIdRef.windowId;
          this.focusService.setConfig(result.loadedConfig);
        }
      });
    } catch (e) {
      console.warn('[startup] Rebuild during restore failed', e);
    }
    return { rotationState, currentIndex: idx, debugActivationLogging: debugFlag, windowId: windowIdRef.windowId };
  }

  /** Reschedules alarms & remote config reloads if needed after worker restart. */
  public async rescheduleIfNeeded(rotationState: RotationState, currentIndexRef: { value: number }): Promise<void> {
    try {
      if (!rotationState?.isRotating) return;
      const { loadedConfig } = await this.configService.loadFromStorage();
      this.focusService.setConfig(loadedConfig);
      const expectedPages = loadedConfig?.pages?.length ?? 0;
      let aliveCount = 0;
      const tracked = Array.isArray(rotationState.tabIds) ? [...new Set(rotationState.tabIds)] : [];
      for (const id of tracked) {
        try { if (id && (await this.tabManager.ensureTabExists(id))) aliveCount++; } catch {}
      }
      if (expectedPages > 0 && aliveCount < expectedPages) {
        // delegate to caller to re-initialize; just exit
        return;
      }
      const alarms = await chrome.alarms.getAll();
      if (!alarms.some(a => a.name === 'rotate')) {
        await this.scheduler.scheduleIn('rotate', 1000);
      }
      const useRemote = (await this.storage.get<boolean>(StorageKeys.UseRemoteConfig)) as boolean;
      if (useRemote) {
        const rs = await this.storage.get<RemoteSettings>(StorageKeys.RemoteSettings);
        const minutes = rs?.configReloadIntervalMinutes ?? 0;
        if (minutes > 0 && !alarms.some(a => a.name === 'configReload')) {
          await this.scheduler.create('configReload', { periodInMinutes: minutes });
        }
      }
    } catch (e) {
      console.error('[startup] rescheduleIfNeeded failed', e, safeRuntimeLastError());
    }
  }

  /** Optional remote config refresh + start if changed; used during initialize path typically. */
  public async fetchAndMaybeStartRemote(
    loadedConfig: any,
    loadedRemoteSettings: any,
    currentConfig: any,
    startRotation: (config: any) => Promise<void>
  ) {
    if (!loadedRemoteSettings || !loadedRemoteSettings.configUrl || !(loadedRemoteSettings.configReloadIntervalMinutes > 0)) {
      await startRotation(loadedConfig);
      return { usedRemote: false };
    }
    const remoteConfig = await this.configService.fetchRemoteConfig(loadedRemoteSettings.configUrl!);
    if (remoteConfig && !isEqual(currentConfig, remoteConfig)) {
      await this.storage.set({ [StorageKeys.RemoteConfig]: remoteConfig });
      await startRotation(remoteConfig);
      await this.scheduler.create('configReload', { periodInMinutes: loadedRemoteSettings.configReloadIntervalMinutes });
      return { usedRemote: true };
    } else if (loadedConfig?.pages?.length) {
      await startRotation(loadedConfig);
      await this.scheduler.create('configReload', { periodInMinutes: loadedRemoteSettings.configReloadIntervalMinutes });
      return { usedRemote: true, fallback: true };
    }
    return { usedRemote: true, started: false };
  }
}
