import { RotationService } from '../rotation.service';
import { StorageService } from '../storage.service';
import { StorageKeys } from '../../app/models';
import { ConfigValidatorService, ToolbarManagerService } from '../../app/services';
import { CustomHttpClient } from '../custom-http-client.service';

/**
 * Verifies initialization error is persisted and loaded by a new service instance.
 */

describe('RotationService initialization error persistence', () => {
  it('persists and reloads initialization error across instances', async () => {
    // Fake chrome API minimal
    const store: Record<string, any> = {};
    (globalThis as any).chrome = {
      storage: { local: { 
        get: async (k: any) => {
          if (Array.isArray(k)) {
            const out: Record<string, any> = {};
            for (const key of k) out[key] = store[key];
            return out;
          }
          if (typeof k === 'string') return { [k]: store[k] };
          return {};
        },
        set: async (vals: any) => { Object.assign(store, vals); },
        remove: async (keys: any) => { const arr = Array.isArray(keys) ? keys : [keys]; arr.forEach(k=> delete store[k]); }
      } },
      runtime: { getManifest: () => ({ version: 'test' }), lastError: null },
      alarms: { getAll: async () => [] },
      tabs: { query: async () => [], get: async () => ({} as any) },
      windows: { getLastFocused: async () => ({ id: 1 }) },
      action: { setIcon: () => {}, setBadgeText: () => {} }
    } as any;

    const storage = new StorageService();
    // Seed stored error
    const msg = 'seeded init failure';
    const at = Date.now() - 5000;
    const stack = 'Error: seeded\n at line1';
    await storage.set({
      [StorageKeys.InitializationError]: msg,
      [StorageKeys.InitializationErrorMeta]: { at, stack }
    });

    const rot = new RotationService(
      new CustomHttpClient(),
      new ConfigValidatorService(),
      new ToolbarManagerService(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      storage
    );
    // Invoke diagnostics to trigger lazy load fallback
    const diags = await rot.getDiagnostics();
    expect(diags.initializationError).toBe(msg);
    expect(diags.initializationErrorAt).toBeGreaterThan(0);
    expect(diags.initializationErrorStack).toContain('seeded');
  });
});
