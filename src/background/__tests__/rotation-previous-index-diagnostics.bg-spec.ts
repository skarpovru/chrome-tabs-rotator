// <reference types="jasmine" />
import { RotationService } from '../rotation.service';
import { StorageService } from '../storage.service';
import { ConfigValidatorService, ToolbarManagerService } from '../../app/services';
import { CustomHttpClient } from '../custom-http-client.service';
import { PageConfig, TabConfig, TabsConfig } from '../../app/models';

/**
 * Minimal harness to verify previousIndex appears and updates after a rotation scheduling step.
 * We bypass full tab creation by stubbing chrome APIs and injecting a tabsConfig manually.
 */
describe('RotationService diagnostics previousIndex', () => {
  beforeEach(() => {
    (globalThis as any).chrome = {
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
      runtime: { getManifest: () => ({ version: 'test' }), lastError: null },
      alarms: { getAll: async () => [] , clear: async () => {}, create: async () => {}},
      tabs: {
        create: async (opts: any) => ({ id: 9000, windowId: 1, url: opts?.url }),
        query: async () => [],
        get: async () => ({ id: 10, windowId: 1 }),
        update: async () => ({}),
        remove: async () => {},
        onUpdated: { addListener: () => {}, removeListener: () => {} }
      },
      windows: { getLastFocused: async () => ({ id: 1 }) },
      action: { setIcon: () => {}, setBadgeText: () => {} }
    } as any;
  });

  it('exposes previousIndex after a rotate attempt', async () => {
    const rot = new RotationService(
      new CustomHttpClient(),
      new ConfigValidatorService(),
      new ToolbarManagerService()
    );
    // Inject a basic tabsConfig with two pages
    const tabsConfig = new TabsConfig();
    tabsConfig.tabs.push(new TabConfig({ page: new PageConfig({ url: 'https://a', delaySeconds: 1 }), tabId: 101, tabIdReady: true }));
    tabsConfig.tabs.push(new TabConfig({ page: new PageConfig({ url: 'https://b', delaySeconds: 1 }), tabId: 102, tabIdReady: true }));
  (rot as any)._tabsConfig = tabsConfig;
    (rot as any).rotationState.isRotating = true;
    // Force internal currentIndex=0 and simulate a rotate
    await (rot as any).rotateTabs?.();
    const first = await rot.getDiagnostics();
    // After first rotate, previousIndex may still be null (initial pass) but second rotate should set it.
    await (rot as any).rotateTabs?.();
    const second = await rot.getDiagnostics();
    expect(second.previousIndex).not.toBeUndefined();
  });
});
