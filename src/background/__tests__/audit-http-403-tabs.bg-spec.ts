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

describe('auditFailedTabStates 403 Forbidden', () => {
  let originalChrome: any;
  let rotation: RotationService;
  let scheduleSpy: jasmine.Spy;
  let activateSpy: jasmine.Spy;

  beforeEach(() => {
    originalChrome = (globalThis as any).chrome;
    (globalThis as any).chrome = {
      tabs: {
        get: async (id: number) => ({ id, title: '403 Forbidden', url: 'https://secure.example.test/forbidden' }),
        query: async () => [{ id: 301, active: true }]
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
    const forbidden = new TabConfig({ page: { url: 'https://secure.example.test/forbidden', delaySeconds: 5, reloadIntervalSeconds: 0 } as any, tabId: 301, tabIdReady: true });
    const healthy = new TabConfig({ page: { url: 'https://ok.example.test/', delaySeconds: 5, reloadIntervalSeconds: 0 } as any, tabId: 302, tabIdReady: true });
    (rotation as any)._tabsConfig = new TabsConfig({ tabs: [forbidden, healthy] });
    (rotation as any).rotationState.isRotating = true;
    scheduleSpy = spyOn(rotation as any, 'scheduleReloadAlarm').and.stub();
    activateSpy = spyOn((rotation as any).activationService, 'activateTabWithFallback').and.stub();
  });

  afterEach(() => {
    (globalThis as any).chrome = originalChrome;
  });

  it('suspends 403 Forbidden tab, classifies as network, and switches focus', async () => {
    const forbiddenCfg = (rotation as any).tabsConfig.tabs[0];
    expect(forbiddenCfg.suspended).toBeFalse();
    await (rotation as any).auditFailedTabStates();
    expect(forbiddenCfg.suspended).toBeTrue();
    // 4xx mapped to 'network'
    expect(forbiddenCfg.failureClassification).toBe('network');
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    const [tabId] = scheduleSpy.calls.mostRecent().args;
    expect(tabId).toBe(301);
    expect(activateSpy).toHaveBeenCalled();
    const [activatedId] = activateSpy.calls.mostRecent().args;
    expect(activatedId).toBe(302);
  });
});
