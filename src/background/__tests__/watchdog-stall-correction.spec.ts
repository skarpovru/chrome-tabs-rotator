import { installBaseChromeMocks } from './test-helpers/chrome-mock';
import { RotationWatchdogService } from '../rotation-watchdog.service';
import { HealthMonitorService } from '../health-monitor.service';
import { SchedulerService } from '../scheduler.service';

class FakeRotator {
  isRotating = true;
  lastActivatedPageIndex = 2; // last page index
  currentIndex = 0; // wrapped to 0 indicates cycle start but stuck
  tabsConfig: any = { tabs: [
    { page: { delaySeconds: 1 }, tabId: 10, nextTabId: 0 },
    { page: { delaySeconds: 1 }, tabId: 11, nextTabId: 0 },
    { page: { delaySeconds: 1 }, tabId: 12, nextTabId: 0 },
  ] };
  stateFacade = { updateIndex: jasmine.createSpy('updateIndex').and.resolveTo(undefined) };
  async onRotateAlarm() {}
  async tryRebuildTabs() {}
  async enforceInvariant() {}
}

describe('RotationWatchdogService stall correction', () => {
  it('records stall and schedules rotate when last page was active long beyond delay', async () => {
    const { createdAlarms } = installBaseChromeMocks();
    const health = new HealthMonitorService();
    // simulate a last rotation far in past (10s ago) so stall heuristics trigger (delay=1s + 5s grace)
    (health as any).timing.lastRotationAt = Date.now() - 10000;
    const scheduler = new SchedulerService();
    const wd = new RotationWatchdogService(health, scheduler, { intervalSeconds: 60, graceSeconds: 5 });
    const rotator = new FakeRotator();

    await wd.handleAlarm(rotator as any);

    const snap = health.snapshot();
    expect(snap.stallCount).toBeGreaterThan(0);
    const rotateAlarm = createdAlarms.find(a => a.name === 'rotate');
    expect(rotateAlarm).toBeDefined();
    expect(rotateAlarm!.when! - Date.now()).toBeLessThan(10_000);
  });
});
