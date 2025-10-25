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

class MemStorage extends StorageService {
  private data: Record<string, any> = {};
  override async get<T>(k: string){ return this.data[k]; }
  override async set(o: Record<string, any>){ Object.assign(this.data,o);}
  override async remove(k: string){ delete this.data[k]; }
}

describe('auditFailedTabStates 500 Internal Server Error', () => {
  let originalChrome: any;
  let rotation: RotationService;
  let scheduleSpy: jasmine.Spy;
  let activateSpy: jasmine.Spy;

  beforeEach(() => {
    originalChrome = (globalThis as any).chrome;
    (globalThis as any).chrome = {
      tabs: {
        get: async (id: number) => ({ id, title: '500 Internal Server Error', url: 'https://api.example.test/fail' }),
        query: async () => [{ id: 401, active: true }]
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
    const failing = new TabConfig({ page: { url: 'https://api.example.test/fail', delaySeconds: 5, reloadIntervalSeconds: 0 } as any, tabId: 401, tabIdReady: true });
    const healthy = new TabConfig({ page: { url: 'https://ok2.example.test/', delaySeconds: 5, reloadIntervalSeconds: 0 } as any, tabId: 402, tabIdReady: true });
    (rotation as any)._tabsConfig = new TabsConfig({ tabs: [failing, healthy] });
    (rotation as any).rotationState.isRotating = true;
    scheduleSpy = spyOn(rotation as any, 'scheduleReloadAlarm').and.stub();
    activateSpy = spyOn((rotation as any).activationService, 'activateTabWithFallback').and.stub();
  });

  afterEach(() => {
    (globalThis as any).chrome = originalChrome;
  });

  it('suspends 500 error tab, classifies as other, and switches focus', async () => {
    const failingCfg = (rotation as any).tabsConfig.tabs[0];
    expect(failingCfg.suspended).toBeFalse();
    await (rotation as any).auditFailedTabStates();
    expect(failingCfg.suspended).toBeTrue();
    expect(failingCfg.failureClassification).toBe('other'); // 5xx mapped to other
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    const [tabId] = scheduleSpy.calls.mostRecent().args;
    expect(tabId).toBe(401);
    expect(activateSpy).toHaveBeenCalled();
    const [activatedId] = activateSpy.calls.mostRecent().args;
    expect(activatedId).toBe(402);
  });
});
