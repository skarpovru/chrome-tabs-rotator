import { RotationService } from '../rotation.service';
import { TabsConfig, TabConfig } from '../../app/models';
import { CustomHttpClient } from '../custom-http-client.service';
import { ConfigValidatorService, ToolbarManagerService } from '../../app/services';
import { ConfigService } from '../config.service';
import { FocusService } from '../focus.service';
import { TabManagerService } from '../tab-manager.service';
import { DiagnosticsService } from '../diagnostics.service';
import { StallGuardService } from '../stall-guard.service';
import { SchedulerService } from '../scheduler.service';
import { StorageService } from '../storage.service';
import { MetricsService } from '../metrics.service';

// In-memory storage stub
class MemStorage extends StorageService {
  private data: Record<string, any> = {};
  override async get<T>(k: string){ return this.data[k]; }
  override async set(o: Record<string, any>){ Object.assign(this.data,o);}
  override async remove(k: string){ delete this.data[k]; }
}

describe('auditFailedTabStates HTTP error / 404 suspension', () => {
  let originalChrome: any;
  let rotation: RotationService;
  let scheduleSpy: jasmine.Spy;
  let activateSpy: jasmine.Spy;

  beforeEach(() => {
    originalChrome = (globalThis as any).chrome;
    // Mock chrome API with active tab query + get for a 404 error page
    (globalThis as any).chrome = {
      tabs: {
        get: async (id: number) => ({ id, title: 'Error 404 (Not Found)!!1', url: 'https://example.test/missing' }),
        query: async () => [{ id: 456, active: true }]
      }
    };
    rotation = new RotationService(
      new CustomHttpClient(),
      new ConfigValidatorService(),
      new ToolbarManagerService(),
      new ConfigService(new CustomHttpClient(), new ConfigValidatorService()),
      undefined,
      new FocusService(),
      new TabManagerService(new MetricsService()),
      new DiagnosticsService(),
      new StallGuardService(),
      new SchedulerService(),
      new MemStorage(),
      new MetricsService()
    );

    // Two tabs: failing active tab (id 456) + healthy fallback tab (id 789)
    const failing = new TabConfig({ page: { url: 'https://example.test/missing', delaySeconds: 5, reloadIntervalSeconds: 0 } as any, tabId: 456, tabIdReady: true });
    const healthy = new TabConfig({ page: { url: 'https://good.test/', delaySeconds: 5, reloadIntervalSeconds: 0 } as any, tabId: 789, tabIdReady: true });
    (rotation as any)._tabsConfig = new TabsConfig({ tabs: [failing, healthy] });
    (rotation as any).rotationState.isRotating = true;

    scheduleSpy = spyOn(rotation as any, 'scheduleReloadAlarm').and.stub();
    activateSpy = spyOn((rotation as any).activationService, 'activateTabWithFallback').and.stub();
  });

  afterEach(() => {
    (globalThis as any).chrome = originalChrome;
  });

  it('suspends 404 error tab and triggers focus switch to healthy tab', async () => {
    const failingCfg = (rotation as any).tabsConfig.tabs[0];
    expect(failingCfg.suspended).toBeFalse();
    await (rotation as any).auditFailedTabStates();
    expect(failingCfg.suspended).toBeTrue();
    expect(failingCfg.failureClassification).toBe('network');
    // Reload alarm scheduled
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    const [tabId] = scheduleSpy.calls.mostRecent().args;
    expect(tabId).toBe(456);
    // Activation should switch to fallback tab id 789
    expect(activateSpy).toHaveBeenCalled();
    const [activatedId] = activateSpy.calls.mostRecent().args;
    expect(activatedId).toBe(789);
  });
});
