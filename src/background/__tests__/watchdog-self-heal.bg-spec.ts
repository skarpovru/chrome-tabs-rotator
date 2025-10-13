import { installBaseChromeMocks } from './test-helpers/chrome-mock';
import { RotationWatchdogService } from '../rotation-watchdog.service';
import { HealthMonitorService } from '../health-monitor.service';
import { SchedulerService } from '../scheduler.service';

// Minimal rotator stub exposing required fields / methods used by watchdog
class FakeRotator {
  isRotating = true;
  lastActivatedPageIndex = 0;
  currentIndex = 0;
  tabsConfig: any = { tabs: [{ page: { delaySeconds: 1 }, tabId: 10, nextTabId: 0 }] };
  stateFacade = { updateIndex: async () => {} } as any;
  async onRotateAlarm() { this.rotateAlarmCalled = true; }
  rotateAlarmCalled = false;
  async tryRebuildTabs() {}
  async enforceInvariant() {}
}

describe('RotationWatchdogService self-heal', () => {
  it('schedules immediate rotate alarm when overdue with none existing', async () => {
    const { createdAlarms } = installBaseChromeMocks();

    const health = new HealthMonitorService();
    // Simulate schedule in past so it is overdue beyond grace
    const overdueAt = Date.now() - 60_000; // 60s ago
    health.recordScheduled(overdueAt);
    const scheduler = new SchedulerService();
    const watchdog = new RotationWatchdogService(health, scheduler, { intervalSeconds: 60, graceSeconds: 5 });
    const rotator = new FakeRotator();

    // Ensure no pre-existing rotate alarm
    // call handler
    await watchdog.handleAlarm(rotator as any);

    // Expect a rotate alarm created (scheduleIn -> when ~ now+1000)
    const rotate = createdAlarms.find(a => a.name === 'rotate');
    expect(rotate).toBeDefined();
    expect(rotate!.when! - Date.now()).toBeLessThan(5000); // scheduled soon
  });

  it('invokes onRotateAlarm immediately when rotate alarm already exists', async () => {
    const { createdAlarms } = installBaseChromeMocks();
    const health = new HealthMonitorService();
    const overdueAt = Date.now() - 60_000;
    health.recordScheduled(overdueAt);
    const scheduler = new SchedulerService();
    const watchdog = new RotationWatchdogService(health, scheduler, { intervalSeconds: 60, graceSeconds: 5 });
    const rotator = new FakeRotator();

    // Pre-create rotate alarm to simulate existing scheduling
    (globalThis as any).chrome.alarms.create('rotate', { when: Date.now() + 30_000 });

    await watchdog.handleAlarm(rotator as any);

    expect(rotator.rotateAlarmCalled).toBeTrue();
    // Should not create a second rotate alarm (only one in list)
    const rotateCount = createdAlarms.filter(a => a.name === 'rotate').length;
    expect(rotateCount).toBe(1);
  });
});
