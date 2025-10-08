// <reference types="jasmine" />
import { RotationSchedulerService, RotationScheduleContext } from '../rotation-scheduler.service';
import { CountdownService, CountdownStartOptions } from '../countdown.service';
import { RotationStateRepository } from '../rotation-state.repository';
import { RotationStateFacade } from '../rotation-state.facade';
import { MetricsService } from '../metrics.service';
import { SchedulerService } from '../scheduler.service';

// Simple fakes/mocks
class FakeCountdown extends CountdownService {
  started: CountdownStartOptions[] = [];
  constructor() { // @ts-ignore
    super({}); }
  override start(opts: CountdownStartOptions) { this.started.push(opts); }
}

class FakeRepo extends RotationStateRepository {
  constructor() { // @ts-ignore
    super({}); }
}

class FakeFacade extends RotationStateFacade {
  constructor(repo: RotationStateRepository) { // @ts-ignore
    super(repo, {} as any, {} as any); }
}

class FakeMetrics extends MetricsService {
  constructor() { // @ts-ignore
    super({}); }
}

class FakeScheduler extends SchedulerService {
  clears: string[] = [];
  creates: { name: string; when?: number }[] = [];
  constructor(){ // @ts-ignore
    super(); }
  override async clear(name: string){ this.clears.push(name); return true; }
  override async create(name: string, info: any){ this.creates.push({ name, when: info.when }); }
}

describe('RotationSchedulerService countdown', () => {
  let countdown: FakeCountdown;
  let scheduler: RotationSchedulerService;
  let fakeSched: FakeScheduler;

  beforeEach(() => {
    (globalThis as any).chrome = {
      alarms: {
        create: jasmine.createSpy('create'),
        clear: jasmine.createSpy('clear'),
        onAlarm: { addListener: () => {} }
      }
    };

    countdown = new FakeCountdown();
    const repo = new FakeRepo();
    // seed initial state
    (repo as any)._state = { isRotating: true, rotationIntervalMs: 15000 };
    const facade = new FakeFacade(repo);
    const metrics = new FakeMetrics();
    fakeSched = new FakeScheduler();
    const health = { recordRotationComplete: () => {}, recordScheduled: () => {}, computeCompositeBadgeColor: () => '#000' } as any;
    scheduler = new RotationSchedulerService(fakeSched as any, health, countdown as any, { computeHealthBadgeColor: () => '#000' } as any);
  });

  it('schedules rotate alarm and starts countdown with interval', async () => {
    const ctx: RotationScheduleContext = { currentIndex: 0, tabCount: 3, delaySeconds: 15 };
    await scheduler.scheduleNext(ctx);
  expect(fakeSched.creates.length).toBe(1);
    const started = countdown.started.pop();
    expect(started!.when).toBeGreaterThan(Date.now());
    // Approximately 15s in future (allowing execution overhead)
    expect(started!.when - Date.now()).toBeGreaterThan(10000);
  });
});
