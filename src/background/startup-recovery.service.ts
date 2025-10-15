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

  /** Restores persisted rotation state (no tab reconstruction; fresh initialize handles tab creation). */
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
    // If rotating, set a force preserve flag so first initialize after restore adopts tabs instead of recreating.
    if (rotationState.isRotating) {
      try {
        const disable = await this.storage.get<boolean>(StorageKeys.DisableAutoPreserveNextInit);
        if (!disable) {
          await this.storage.set({ [StorageKeys.ForcePreserveNextInit]: true });
        }
      } catch {}
    }
    const idx = Number(currentIndex ?? 0);
    return { rotationState, currentIndex: idx, debugActivationLogging: debugFlag, windowId: windowIdRef.windowId };
  }

  /** Reschedules alarms & remote config reloads if needed after worker restart. */
  public async rescheduleIfNeeded(rotationState: RotationState, currentIndexRef: { value: number }): Promise<{ reinitNeeded: boolean }> {
    try {
      if (!rotationState?.isRotating) return { reinitNeeded: false };
      const { loadedConfig } = await this.configService.loadFromStorage();
      this.focusService.setConfig(loadedConfig);
      const expectedPages = loadedConfig?.pages?.length ?? 0;
      let aliveCount = 0;
      const tracked = Array.isArray(rotationState.tabIds) ? [...new Set(rotationState.tabIds)] : [];
      for (const id of tracked) {
        try { if (id && (await this.tabManager.ensureTabExists(id))) aliveCount++; } catch {}
      }
      // Additional heuristic: even if counts match enough to avoid early reinit, verify URL coverage.
      let urlCoverageOk = true;
      if (expectedPages > 0) {
        try {
          const existing = await chrome.tabs.query({});
          const existingUrls = new Set(existing.filter(t => !!t.url).map(t => t.url!));
          const missingUrls: string[] = [];
            for (const p of (loadedConfig.pages || [])) {
              if (p?.url && !existingUrls.has(p.url)) missingUrls.push(p.url);
            }
          // If more than half of the configured URLs are missing while state says rotating, force reinit.
          if (missingUrls.length > Math.floor(expectedPages / 2)) urlCoverageOk = false;
          if (!urlCoverageOk && (chrome as any)?.runtime?.lastError == null) {
            console.debug('[startup] reschedule: URL coverage insufficient; triggering reinit', { missingUrls: missingUrls.slice(0,5) });
          }
        } catch {}
      }
      if ((expectedPages > 0 && aliveCount < expectedPages) || !urlCoverageOk) {
        try {
          (rotationState as any).__resumeReason = {
            at: Date.now(),
            expectedPages,
            aliveCount,
            urlCoverageOk,
            trackedCount: tracked.length,
            reason: 'alive-or-coverage-mismatch'
          };
        } catch {}
        return { reinitNeeded: true };
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
      return { reinitNeeded: false };
    } catch (e) {
      console.error('[startup] rescheduleIfNeeded failed', e, safeRuntimeLastError());
      try { (rotationState as any).__resumeReason = { at: Date.now(), error: String(e) }; } catch {}
      return { reinitNeeded: false };
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
