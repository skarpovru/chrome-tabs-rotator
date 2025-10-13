// <reference types="jasmine" />
import { RotationWatchdogService } from '../rotation-watchdog.service';
import { HealthMonitorService } from '../health-monitor.service';
import { SchedulerService } from '../scheduler.service';

describe('RotationWatchdogService', () => {
  it('schedules rotate when overdue beyond grace', async () => {
    const health = new HealthMonitorService();
    const scheduler = new SchedulerService();
    const watchdog = new RotationWatchdogService(health, scheduler, { intervalSeconds: 1, graceSeconds: 2 });
    let scheduledInMs: number | undefined;
    (globalThis as any).chrome = {
      alarms: {
        get: async () => undefined,
        getAll: async () => [],
        clear: async () => true,
        create: (name: string, info: any) => { if (name === 'rotate') scheduledInMs = info.when ? info.when - Date.now() : 0; }
      }
    };
    const rotator: any = { isRotating: true, onRotateAlarm: async () => {}, constructor: { ALARM_ROTATE: 'rotate' } };
    // Simulate scheduled rotation in past
    health.recordScheduled(Date.now() - 5000); // due 5s ago
    await watchdog.handleAlarm(rotator);
    expect(scheduledInMs).toBeDefined();
  });
});
