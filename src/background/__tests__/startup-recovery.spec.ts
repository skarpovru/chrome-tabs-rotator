// <reference types="jasmine" />
import { StartupRecoveryService } from '../startup-recovery.service';
import { RotationStateRepository } from '../rotation-state.repository';
import { StorageService } from '../storage.service';
import { ConfigService } from '../config.service';
import { FocusService } from '../focus.service';
import { TabManagerService } from '../tab-manager.service';
import { SchedulerService } from '../scheduler.service';
import { InvariantRebuilderService } from '../invariant-rebuilder.service';
import { HealthMonitorService } from '../health-monitor.service';
import { ActivationDiagnosticsService } from '../activation-diagnostics.service';
import { RotationState } from '../../app/models';

class RotationStateRepoStub extends RotationStateRepository {
  private state: RotationState = new RotationState();
  private currentIndex = 0;
  constructor(storage: StorageService) { super(storage); }
  override async load() { return { state: this.state, currentIndex: this.currentIndex }; }
  setMock(data: { state?: RotationState; currentIndex?: number }) { if (data.state) this.state = data.state; if (typeof data.currentIndex === 'number') this.currentIndex = data.currentIndex; }
}

describe('StartupRecoveryService.rescheduleIfNeeded', () => {
  let service: StartupRecoveryService;
  let repo: RotationStateRepoStub;
  let storage: StorageService;
  let configService: ConfigService;
  let focus: FocusService;
  let tabManager: TabManagerService;
  let scheduler: SchedulerService;
  let invariant: InvariantRebuilderService;
  let health: HealthMonitorService;
  let actDiag: ActivationDiagnosticsService;

  beforeEach(() => {
    (globalThis as any).chrome = {
      tabs: {
        get: jasmine.createSpy('get').and.callFake(async (id:number)=> ({ id, url: 'https://a.example', windowId: 1 })),
        query: jasmine.createSpy('query').and.resolveTo([{ id: 10, url: 'https://a.example' }, { id: 11, url: 'https://b.example' }])
      },
      alarms: { getAll: jasmine.createSpy('getAll').and.resolveTo([]), create: jasmine.createSpy('create').and.callFake(()=>{}) },
      runtime: {}
    };
    storage = new StorageService();
    repo = new RotationStateRepoStub(storage);
    configService = new ConfigService({} as any, {} as any);
    spyOn(configService, 'loadFromStorage').and.resolveTo({ loadedConfig: { pages: [
      { url: 'https://a.example', delaySeconds: 10, reloadIntervalSeconds: 0 },
      { url: 'https://b.example', delaySeconds: 10, reloadIntervalSeconds: 0 }
    ], isFullscreen: false, preventWindowFocus: false }, loadedRemoteSettings: undefined, useRemote: false });
    focus = new FocusService();
    tabManager = new TabManagerService();
    scheduler = new SchedulerService();
    invariant = new InvariantRebuilderService(configService, tabManager);
    health = new HealthMonitorService();
    actDiag = new ActivationDiagnosticsService(storage);
    service = new StartupRecoveryService(repo, storage, configService, focus, tabManager, scheduler, invariant, health, actDiag);
  });

  it('returns reinitNeeded=true when fewer alive tabs than expected', async () => {
    const rotationState = new RotationState();
    rotationState.isRotating = true;
    rotationState.tabIds = [10]; // only one tracked while config expects 2
    const result = await service.rescheduleIfNeeded(rotationState, { value: 0 });
    expect(result.reinitNeeded).toBeTrue();
  });

  it('returns reinitNeeded=false when all expected tabs alive', async () => {
    const rotationState = new RotationState();
    rotationState.isRotating = true;
  rotationState.tabIds = [10,11];
    const result = await service.rescheduleIfNeeded(rotationState, { value: 0 });
    expect(result.reinitNeeded).toBeFalse();
  });
});
