import { ConfigService } from '../config.service';
import { ConfigValidatorService } from '../../app/services/config-validator.service';
import { StorageKeys, ConfigData } from '../../app/models';

/**
 * Ensures the reuseLocalFileTabs flag survives storage round-trips and defaults to false when absent.
 */
describe('ConfigService serialization round-trip for reuseLocalFileTabs', () => {
  let stored: Record<string, any>; let svc: ConfigService;

  beforeEach(() => {
    stored = {};
    // Provide a chrome stub with storage + minimal tabs/windows/alarms to avoid leaking a reduced stub to later specs.
    (globalThis as any).chrome = {
      tabs: {
        query: async () => [],
        get: async (id: number) => ({ id, active: true, url: 'about:blank' }),
        update: async () => {},
        create: async (opts: any) => ({ id: Math.random() * 1000 | 0, url: opts?.url || 'about:blank', active: false, windowId: 1 }),
        onUpdated: { addListener: () => {}, removeListener: () => {} }
      },
      windows: { getLastFocused: async () => ({ id: 1 }) },
      alarms: { create: async () => {}, clear: async () => true, getAll: async () => [] },
      storage: { local: {
        get: async (key: any) => {
          if (typeof key === 'string') return { [key]: stored[key] };
          if (Array.isArray(key)) { const out: any = {}; key.forEach(k => out[k] = stored[k]); return out; }
          return {};
        },
        set: async (vals: Record<string, any>) => { Object.assign(stored, vals); },
        remove: async (k: string | string[]) => { const arr = Array.isArray(k) ? k : [k]; arr.forEach(x => delete stored[x]); }
      }}
    } as any;
    svc = new ConfigService({} as any, new ConfigValidatorService(), undefined as any);
  });

  it('treats missing reuseLocalFileTabs as false (flag absent)', async () => {
    stored[StorageKeys.LocalConfig] = { pages: [ { url: 'https://a.test', delaySeconds: 5, reloadIntervalSeconds: 0 } ] };
    const { loadedConfig } = await svc.loadFromStorage();
    // Property absent (undefined) should behave like false when coerced.
    expect(loadedConfig.reuseLocalFileTabs).toBeUndefined();
    expect(!!loadedConfig.reuseLocalFileTabs).toBeFalse();
  });

  it('persists reuseLocalFileTabs=true after update + reload', async () => {
    stored[StorageKeys.LocalConfig] = { pages: [ { url: 'https://a.test', delaySeconds: 5, reloadIntervalSeconds: 0 } ] };
    let { loadedConfig } = await svc.loadFromStorage();
    expect(!!loadedConfig.reuseLocalFileTabs).toBeFalse(); // initial missing flag

    // Toggle flag and persist round-trip
    loadedConfig.reuseLocalFileTabs = true;
    await chrome.storage.local.set({ [StorageKeys.LocalConfig]: loadedConfig });

    // Fresh service instance to force reload
    svc = new ConfigService({} as any, new ConfigValidatorService(), undefined as any);
    const result2 = await svc.loadFromStorage();
    expect(result2.loadedConfig.reuseLocalFileTabs).toBeTrue();
  });
});
