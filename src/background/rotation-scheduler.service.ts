import { SchedulerService } from './scheduler.service';
import { HealthMonitorService } from './health-monitor.service';
import { CountdownService } from './countdown.service';
import { ActivationDiagnosticsService } from './activation-diagnostics.service';
import { TabsConfig } from '../app/models';

export interface ScheduleResult {
  nextIndex: number;
  when: number;
}

export interface RotationScheduleContext {
  currentIndex: number;
  tabCount: number;
  delaySeconds: number;
  tabsConfig?: TabsConfig;
}

export class RotationSchedulerService {
  constructor(
    private scheduler: SchedulerService,
    private health: HealthMonitorService,
    private countdown: CountdownService,
    private activationDiagnostics: ActivationDiagnosticsService
  ) {}

  public async scheduleNext(ctx: RotationScheduleContext): Promise<ScheduleResult> {
    const { currentIndex, tabCount, delaySeconds, tabsConfig } = ctx;
    if (tabCount === 0) throw new Error('scheduleNext called with tabCount=0');
    let nextIndex = (currentIndex + 1) % tabCount;
    if (tabsConfig?.tabs?.length) {
      const isFailed = (i: number) => {
        const t = tabsConfig!.tabs[i];
        return !!t?.suspended || !!t?.lastNetworkErrorCode;
      };
      let guard = 0;
      while (guard < tabCount && isFailed(nextIndex)) {
        nextIndex = (nextIndex + 1) % tabCount;
        guard++;
      }
    }
    const when = Date.now() + Math.max(1, delaySeconds) * 1000;
    await this.scheduler.clear('rotate');
    await this.scheduler.create('rotate', { when });
    this.health.recordRotationComplete();
    this.health.recordScheduled(when);
    try {
      this.countdown.start({
        when,
        tabsConfig,
        compositeColorProvider: () =>
          this.health.computeCompositeBadgeColor(
            this.activationDiagnostics.computeHealthBadgeColor(tabsConfig)
          ),
      });
    } catch {}
    return { nextIndex, when };
  }
}
