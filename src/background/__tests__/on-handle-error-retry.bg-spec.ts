import { RotationService } from '../rotation.service';
import { ConfigValidatorService, ToolbarManagerService } from '../../app/services';
import { CustomHttpClient } from '../custom-http-client.service';
import { TabManagerService } from '../tab-manager.service';
import { MetricsService } from '../metrics.service';
import { FocusService } from '../focus.service';
import { SchedulerService } from '../scheduler.service';
import { StorageService } from '../storage.service';
import { ConfigService } from '../config.service';

// Minimal chrome mock for methods touched by onHandleError
(function ensureChromeMock(){
  if (!(globalThis as any).chrome) (globalThis as any).chrome = {};
  const c: any = (globalThis as any).chrome;
  c.tabs = c.tabs || { update: async () => {}, get: async (id: number) => ({ id, active: false }) };
})();

describe('RotationService.onHandleError retry path', () => {
  let service: any;
  beforeEach(() => {
    const http = new CustomHttpClient();
    const validator = new ConfigValidatorService();
    const toolbar = new ToolbarManagerService();
    const configSvc = new ConfigService(http, validator);
    const tabManager = new TabManagerService(new MetricsService());
    service = new RotationService(
      http,
      validator,
      toolbar,
      configSvc,
      { restore: async () => ({}) } as any,
      new FocusService(),
      tabManager,
      undefined,
      undefined,
      new SchedulerService(),
      new StorageService(),
      new MetricsService()
    );
  (service as any)._tabsConfig = { tabs: [ { page: { url: 'https://fail.test', reloadIntervalSeconds: 0, delaySeconds: 2 }, tabId: 111, nextTabId: 0, tabIdReady: true, nextTabIdReady: false, retryCount: 0, suspended: false } ] };
  (service as any).tabManager.tabsConfig = (service as any)._tabsConfig;
    (service as any).__setMaxRetriesForTest(1);
    (service as any).__testForceSimpleRetry = true;
  });
  it('increments retryCount on first error when below maxRetries', async () => {
    const tabCfg = (service as any).tabsConfig.tabs[0];
    expect(tabCfg.retryCount).toBe(0);
    await service.onHandleError(tabCfg.tabId, tabCfg.page.url);
    expect(tabCfg.retryCount).toBe(1);
    expect(tabCfg.suspended).toBeFalse();
  });
  it('suspends after exceeding maxRetries', async () => {
    const tabCfg = (service as any).tabsConfig.tabs[0];
    await service.onHandleError(tabCfg.tabId, tabCfg.page.url); // first error
    expect(tabCfg.retryCount).toBe(1);
    await new Promise(r => setTimeout(r, 550));
    await service.onHandleError(tabCfg.tabId, tabCfg.page.url); // second error
    expect(tabCfg.retryCount).toBe(1);
    expect(tabCfg.suspended).toBeTrue();
  });
});
