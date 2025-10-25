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

// Simple in‑memory storage stub to avoid Chrome storage dependency.
class MemStorage extends StorageService {
  private data: Record<string, any> = {};
  override async get<T>(k: string){ return this.data[k]; }
  override async set(o: Record<string, any>){ Object.assign(this.data,o);}
  override async remove(k: string){ delete this.data[k]; }
}

describe('auditFailedTabStates heuristic suspension', () => {
  let originalChrome: any;
  let rotation: RotationService;
  let scheduleSpy: jasmine.Spy;

  beforeEach(() => {
    originalChrome = (globalThis as any).chrome;
    // Mock chrome.tabs.get to emulate a privacy/certificate style error tab.
    (globalThis as any).chrome = {
      tabs: {
        get: async (id: number) => ({ id, title: 'Privacy error', url: 'https://fail.test/' }),
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
    // Inject tabsConfig with one mapped tab; mark service as rotating.
    const failing = new TabConfig({ page: { url: 'https://fail.test/', delaySeconds: 5, reloadIntervalSeconds: 0 } as any, tabId: 123, tabIdReady: true });
    (rotation as any)._tabsConfig = new TabsConfig({ tabs: [failing] });
    (rotation as any).rotationState.isRotating = true;
    scheduleSpy = spyOn(rotation as any, 'scheduleReloadAlarm').and.stub();
  });

  afterEach(() => {
    (globalThis as any).chrome = originalChrome;
  });

  it('marks privacy-error tab suspended and schedules reload with default interval', async () => {
    const cfg = (rotation as any).tabsConfig.tabs[0];
    expect(cfg.suspended).not.toBeTrue();
    await (rotation as any).auditFailedTabStates();
    expect(cfg.suspended).toBeTrue();
    expect(cfg.failureClassification).toBe('network'); // default classification applied when heuristic triggers
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    const [tabId, seconds] = scheduleSpy.calls.mostRecent().args;
    expect(tabId).toBe(123);
    const expected = (rotation as any).defaultFailedPageReloadIntervalSeconds; // should fall back to default (page.reloadIntervalSeconds == 0)
    expect(seconds).toBe(expected);
  });

  it('uses page.reloadIntervalSeconds when smaller than default', async () => {
    // Reconfigure page with a non-zero reload interval smaller than default (e.g. 30 < 120)
    const cfg = (rotation as any).tabsConfig.tabs[0];
    cfg.page.reloadIntervalSeconds = 30;
    cfg.suspended = false; // ensure not pre-marked
    scheduleSpy.calls.reset();
    await (rotation as any).auditFailedTabStates();
    expect(cfg.suspended).toBeTrue();
    const [tabId, seconds] = scheduleSpy.calls.mostRecent().args;
    expect(tabId).toBe(123);
    expect(seconds).toBe(30); // should honor smaller interval
  });

  it('skips already suspended tab (no duplicate scheduling)', async () => {
    const cfg = (rotation as any).tabsConfig.tabs[0];
    cfg.suspended = true;
    scheduleSpy.calls.reset();
    await (rotation as any).auditFailedTabStates();
    expect(scheduleSpy).not.toHaveBeenCalled();
  });
});
