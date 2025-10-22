// <reference types="jasmine" />
import { RotationService } from '../rotation.service';
import { StorageService } from '../storage.service';
import { ConfigValidatorService, ToolbarManagerService } from '../../app/services';
import { CustomHttpClient } from '../custom-http-client.service';

/**
 * Verifies enforceResumeAt gets cleared (set to 0) once diagnostics are assembled after grace expiry.
 */
describe('RotationService diagnostics enforceResumeAt clearing', () => {
  beforeEach(() => {
    (globalThis as any).chrome = {
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
      runtime: { getManifest: () => ({ version: 'test' }), lastError: null },
      alarms: { getAll: async () => [] , clear: async () => {}, create: async () => {}},
      tabs: { create: async (opts: any) => ({ id: 9100, windowId: 1, url: opts?.url }), query: async () => [], get: async () => ({ id: 11, windowId: 1 }), update: async () => ({}), onUpdated: { addListener: () => {}, removeListener: () => {} } },
      windows: { getLastFocused: async () => ({ id: 1 }) },
      action: { setIcon: () => {}, setBadgeText: () => {} }
    } as any;
  });

  it('clears expired enforceResumeAt timestamp', async () => {
    const rot = new RotationService(
      new CustomHttpClient(),
      new ConfigValidatorService(),
      new ToolbarManagerService()
    );
    (rot as any).enforceResumeAt = Date.now() - 10000; // already expired
    const diags = await rot.getDiagnostics();
    expect(diags.enforceResumeAt).toBe(0);
  });
});
