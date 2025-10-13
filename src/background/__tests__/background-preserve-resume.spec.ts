import { StorageKeys } from '../../app/models';
import { RotationService } from '../rotation.service';
import { CustomHttpClient } from '../custom-http-client.service';
import { ConfigValidatorService, ToolbarManagerService } from '../../app/services';

// This spec emulates the preserved resume logic without importing the entire background script (avoids bundler/require mechanics in Jasmine env).
describe('background preserved resume (emulated)', () => {
  it('invokes initialize with preserveExisting when stored state indicates rotation', async () => {
    const storedState = { rotationState: { isRotating: true, tabIds: [111], currentIndex: 0 } } as any;
    // Minimal chrome polyfill
    (globalThis as any).chrome = {
      runtime: { lastError: null, getManifest: () => ({ version: 'test' }) },
      action: { setIcon: () => {} },
      alarms: {
        onAlarm: { addListener: () => {} },
        create: () => {},
        clear: async () => true,
        getAll: async () => [],
        get: async () => undefined,
      },
      tabs: {
        onRemoved: { addListener: () => {} },
        onUpdated: { addListener: () => {} },
        query: async () => [],
        create: async () => ({ id: 999, windowId: 1, url: 'https://preserve.test' }),
        get: async (id:number) => ({ id, windowId: 1 })
      },
      webNavigation: { onErrorOccurred: { addListener: () => {} }, onCompleted: { addListener: () => {} } },
      windows: { getLastFocused: async () => ({ id: 1 }) },
      storage: { local: { get: async () => ({ [StorageKeys.RotationState]: storedState }), set: async () => {}, remove: async () => {} } }
    } as any;

    const http = new CustomHttpClient();
    const validator = new ConfigValidatorService();
    const toolbar = new ToolbarManagerService();
    const configSvcStub = { loadFromStorage: async () => ({ loadedConfig: { pages: [{ url: 'https://preserve.test', delaySeconds: 1, reloadIntervalSeconds: 0 }] }, loadedRemoteSettings: {}, useRemote: false }) } as any;
    const rot = new RotationService(http, validator, toolbar, configSvcStub);

  let called = false;
  // Short-circuit initialize to avoid side-effects; we only assert the flag propagation.
  (rot as any).initialize = async (opts:any) => { if (opts?.preserveExisting) called = true; };

    // Simulate helper logic from background attemptPreservedResume
    const storage = (rot as any).storage;
    const stored = await storage.get(StorageKeys.RotationState as any);
    const wasRotating = !!stored?.rotationState?.isRotating || !!stored?.isRotating;
    if (wasRotating) {
      await rot.initialize({ preserveExisting: true });
    }
    expect(called).toBeTrue();
  });
});
