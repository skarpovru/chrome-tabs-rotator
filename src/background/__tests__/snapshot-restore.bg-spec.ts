import { RotationService } from '../rotation.service';
import { TabConfig, TabsConfig } from '../../app/models';
import { StorageKeys } from '../../app/models/storage-keys.enum';

describe('RotationService - Snapshot Restoration', () => {
  let rotation: RotationService;

  beforeEach(() => {
    // Mock chrome APIs needed by constructor + initialize
    const stored: Record<string, any> = {};
    (globalThis as any).chrome = {
      tabs: {
        query: async () => [{ id: 10, active: true, url: 'https://a.test' }],
        get: async (id: number) => ({ id, active: id === 10, url: id === 10 ? 'https://a.test' : 'https://b.test' }),
        update: async () => {},
        create: async (opts: any) => ({ id: Math.random()*1000|0, url: opts.url, active: false, windowId: 1 }),
        onUpdated: {
          addListener: () => {},
          removeListener: () => {}
        }
      },
      windows: { getLastFocused: async () => ({ id:1 }) },
      alarms: { create: async () => {}, clear: async () => true, getAll: async () => [] },
      storage: { local: {
        get: async (key: any) => {
          if (typeof key === 'string') return { [key]: stored[key] };
          if (Array.isArray(key)) { const out: any = {}; key.forEach(k => out[k]=stored[k]); return out; }
          return {};
        },
        set: async (vals: Record<string, any>) => { Object.assign(stored, vals); },
        remove: async (k: string|string[]) => { const arr = Array.isArray(k)?k:[k]; arr.forEach(x=> delete stored[x]); }
      }}
    } as any;

    // Seed LocalConfig with two pages matching snapshot URLs
    stored[StorageKeys.LocalConfig] = { pages: [
      { url: 'https://a.test', delaySeconds: 5, reloadIntervalSeconds: 30 },
      { url: 'https://b.test', delaySeconds: 5, reloadIntervalSeconds: 30 }
    ]};

    // Provide snapshot with suspension + network error metadata for second tab
    stored[StorageKeys.TabsConfigSnapshot] = {
      at: Date.now()-1000,
      reason: 'test-seed',
      tabs: [
        { url: 'https://a.test', suspended: false, retryCount: 0, primaryCompleteObserved: true },
        { url: 'https://b.test', suspended: true, lastNetworkErrorCode: 'net::ERR_NAME_NOT_RESOLVED', lastNetworkErrorAt: Date.now()-500, failureClassification: 'dns', retryCount: 1 }
      ]
    };

    rotation = new RotationService({} as any, {} as any, {} as any);
  });

  it('should merge snapshot metadata after initialize', async () => {
    await rotation.initialize();
    // After initialize, tabsConfig should have two entries
    const tabs = rotation.tabsConfig.tabs;
    expect(tabs.length).toBe(2);
    const a = tabs.find(t => t.page.url === 'https://a.test')!;
    const b = tabs.find(t => t.page.url === 'https://b.test')!;
    // a untouched
    expect(a.suspended).toBeFalse();
    // b restored from snapshot
    expect(b.suspended).toBeTrue();
    expect(b.lastNetworkErrorCode).toBe('net::ERR_NAME_NOT_RESOLVED');
    expect(typeof b.lastNetworkErrorAt).toBe('number');
    expect(b.failureClassification).toBe('dns');
    expect(b.retryCount).toBe(1);
  });

  it('should not unsuspend snapshot-suspended tab during first rotate', async () => {
    await rotation.initialize();
    const b = rotation.tabsConfig.tabs.find(t => t.page.url === 'https://b.test')!;
    expect(b.suspended).toBeTrue();
    // Force rotating state
    (rotation as any).rotationState.isRotating = true;
    // Attempt rotate tick; suspended tab should remain skipped
    await (rotation as any).rotateTabs();
    expect(b.suspended).toBeTrue();
  });
});
