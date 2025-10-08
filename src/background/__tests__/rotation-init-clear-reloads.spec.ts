import { installBaseChromeMocks } from './test-helpers/chrome-mock';
import { RotationService } from '../rotation.service';
import { SchedulerService } from '../scheduler.service';
import { installChromeWithStorage } from './test-helpers/rotation-service-harness';

class MemoryStorageService {
  private store: Record<string, any> = {};
  async get(key: string) { return this.store[key]; }
  async set(values: Record<string, any>) { Object.assign(this.store, values); }
  async remove(keys: string | string[]) { const arr = Array.isArray(keys)? keys:[keys]; for (const k of arr) delete this.store[k]; }
}

describe('RotationService.initialize clears leftover reload:* alarms', () => {
  it('clears pre-existing reload alarms while leaving unrelated alarms', async () => {
  const { createdAlarms, clearedAlarms } = installBaseChromeMocks();
    // Seed some leftover reload alarms + an unrelated alarm
    chrome.alarms.create('reload:101', { when: Date.now() + 10000 });
    chrome.alarms.create('reload:202', { when: Date.now() + 15000 });
    chrome.alarms.create('notReload', { when: Date.now() + 5000 });

    // Provide a minimal configService stub returning empty pages so rotation doesn't start heavy logic
    const configServiceStub = {
      loadFromStorage: async () => ({ loadedConfig: { pages: [] }, loadedRemoteSettings: {} })
    } as any;
    const focusServiceStub = { setConfig: () => {} } as any;
    const toolbarStub = { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, setIcon: () => {} } as any;
    const scheduler = new SchedulerService();
    const storageStub = new MemoryStorageService() as any; // matches minimal interface used by RotationStateRepository
    const tabManagerStub = { adoptOwnership: () => {} } as any;

    const rot = new RotationService(
      {} as any, // http
      {} as any, // configValidator
      toolbarStub,
      configServiceStub,
      undefined, // startupRecovery
      focusServiceStub,
      tabManagerStub as any,
      {} as any, // diagnostics
      {} as any, // stallGuard
      scheduler,
      storageStub,
      {} as any // metrics
    );

    await rot.initialize();

    // Expect both reload alarms cleared
    expect(clearedAlarms).toContain('reload:101');
    expect(clearedAlarms).toContain('reload:202');
    // Unrelated alarm should NOT have been cleared by clearAllReloads (initialize might clear rotate/config/watchdog only)
    expect(clearedAlarms).not.toContain('notReload');
    // Ensure we didn't accidentally remove them from created list (createdAlarms retains originals)
    const remainingNames = createdAlarms.map(a => a.name);
    expect(remainingNames).toContain('notReload');
  });
});
