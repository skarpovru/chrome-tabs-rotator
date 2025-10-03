import { HealthMonitorService } from './health-monitor.service';
import { SchedulerService } from './scheduler.service';
import { RotationService } from './rotation.service';

export interface WatchdogConfig {
  intervalSeconds: number;
  graceSeconds: number;
}

export class RotationWatchdogService {
  constructor(
    private health: HealthMonitorService,
    private scheduler: SchedulerService,
    private config: WatchdogConfig
  ) {}

  async handleAlarm(rotator: RotationService): Promise<void> {
    if (!rotator.isRotating) return;
    const now = Date.now();
    let didHeal = false;
    const snap = this.health.snapshot();
    if (snap.nextRotationDueAt && now > snap.nextRotationDueAt + this.config.graceSeconds * 1000) {
      const overdueSeconds = Math.round((now - snap.nextRotationDueAt) / 1000);
      console.warn('[watchdog] Overdue rotation detected (overdue=%ds). Attempting self-heal.', overdueSeconds);
      didHeal = true;
      try {
        await (rotator as any).tryRebuildTabs?.();
        await (rotator as any).enforceInvariant?.(true);
        const rotateAlarm = await chrome.alarms.get((rotator as any).constructor.ALARM_ROTATE || 'rotate');
        if (!rotateAlarm) {
          await this.scheduler.scheduleIn('rotate', 1000);
          console.info('[watchdog] Scheduled immediate rotate alarm.');
        } else {
          await rotator.onRotateAlarm();
        }
      } catch (e) {
        console.error('[watchdog] Self-heal failed', e);
      }
    }
    if (!didHeal) {
      try {
        await (rotator as any).enforceInvariant?.();
        const tabCount = (rotator as any).tabsConfig?.tabs?.length || 0;
        if (tabCount > 1 && (rotator as any).lastActivatedPageIndex === tabCount - 1 && (rotator as any).currentIndex === 0) {
          const firstDelay = (rotator as any).tabsConfig?.tabs[0]?.page?.delaySeconds || 1;
          const snap2 = this.health.snapshot();
            if (snap2.lastRotationAt && Date.now() > snap2.lastRotationAt + firstDelay * 1000 + 5000) {
              this.health.recordStall('watchdog-stuck-last-page');
              console.warn('[watchdog] Stall correction: forcing rotate to first page.');
              (rotator as any).currentIndex = 0;
              await (rotator as any).stateFacade.updateIndex((rotator as any).currentIndex);
              await chrome.alarms.clear('rotate');
              await this.scheduler.scheduleIn('rotate', 1000);
            }
        }
      } catch (e) {
        console.debug('[watchdog] Invariant check skipped', e);
      }
    }
  }
}
