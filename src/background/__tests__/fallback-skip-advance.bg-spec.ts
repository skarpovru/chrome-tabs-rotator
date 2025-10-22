import { RotationService } from '../rotation.service';
import { TabConfig, TabsConfig } from '../../app/models';

describe('RotationService - fallback activation does not advance index', () => {
  it('preserves currentIndex when fallbackActivationSkipAdvance set', async () => {
    // Minimal chrome stub
  const globalAny = globalThis as any;
  globalAny.chrome = {
      tabs: {
        query: async () => [{ id: 11, active: true }],
        update: async (id: number) => ({ id, windowId: 1 }),
        get: async (id: number) => ({ id, active: id === 11, windowId: 1 }),
        highlight: async () => {},
        create: async ({ url }: any) => ({ id: 99, url, windowId: 1 })
      },
      windows: { update: async () => {}, getAll: async () => [{ tabs: [{ id:11, active:true }] }] },
      alarms: { clear: async () => {}, clearAll: async () => {}, create: async () => {} },
      storage: { local: { set: async () => {}, get: async () => ({}) } },
      action: { setBadgeText: async () => {} }
    };

    // Stub dependencies (only those accessed)
    const http = {} as any;
    const validator = {} as any;
    const toolbar = { setState: () => {} } as any;
    const configService = { loadFromStorage: async () => ({ loadedConfig: { pages: [ { url:'https://a.example', delaySeconds:2, reloadIntervalSeconds:0 }, { url:'https://b.example', delaySeconds:2, reloadIntervalSeconds:0 } ], preventWindowFocus:false, isFullscreen:false }, loadedRemoteSettings: undefined }) } as any;
    const rotation = new RotationService(http, validator, toolbar, configService);
    (rotation as any).rotationState.isRotating = true;
    (rotation as any)._tabsConfig = new TabsConfig();
    (rotation as any)._tabsConfig.tabs = [
      new TabConfig({ page:{ url:'https://a.example', delaySeconds:2, reloadIntervalSeconds:0 }, active:true }),
      new TabConfig({ page:{ url:'https://b.example', delaySeconds:2, reloadIntervalSeconds:0 }, active:false })
    ];
    (rotation as any)._tabsConfig.tabs[0].tabId = 11; (rotation as any)._tabsConfig.tabs[0].tabIdReady = true;
    (rotation as any)._tabsConfig.tabs[1].tabId = 12; (rotation as any)._tabsConfig.tabs[1].tabIdReady = true;
    (rotation as any).tabManager.tabsConfig = (rotation as any)._tabsConfig;
    (rotation as any).currentIndex = 0;
    (rotation as any).previousIndex = 1; // simulate last page before failure
    (rotation as any).fallbackActivationSkipAdvance = true;
    // Inject lightweight activation + scheduler stubs
    (rotation as any).activationService = { activateTabWithFallback: async () => true };
    (rotation as any).rotationScheduler = { scheduleNext: async ({ currentIndex }: any) => ({ nextIndex: (currentIndex + 1) % 2 }) };
    (rotation as any).stateFacade = { updateIndex: async () => {}, set: async () => {} };
    (rotation as any).storage = { set: async () => {}, get: async () => ({}) };
    (rotation as any).scheduler = { clear: async () => {}, scheduleIn: async () => {}, clearAllReloads: async () => {}, create: async () => {} };
    (rotation as any).healthMonitor = { snapshot: () => ({ lastRotationAt: Date.now() }), clearSchedule: () => {}, adoptStallState: () => {} };
    (rotation as any).stallGuard = { evaluateRotation: () => false, state: {} };
    (rotation as any).metrics = { recordRotation: () => {}, recordStall: () => {} };
    await (rotation as any).rotateTabs();
    expect((rotation as any).currentIndex).toBe(0);
  });
});
