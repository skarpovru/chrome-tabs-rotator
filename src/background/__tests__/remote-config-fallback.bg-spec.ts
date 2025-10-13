// <reference types="jasmine" />
import { RotationService } from '../rotation.service';
import { ConfigValidatorService, ToolbarManagerService } from '../../app/services';
import { CustomHttpClient } from '../custom-http-client.service';
import { StorageService } from '../storage.service';
import { TabManagerService } from '../tab-manager.service';
import { MetricsService } from '../metrics.service';
import { installBaseChromeMocks } from './test-helpers/chrome-mock';
import { installChromeWithStorage } from './test-helpers/rotation-service-harness';
import { SchedulerService } from '../scheduler.service';
import { ConfigService } from '../config.service';

// Test scenario: remote settings present, fetchRemoteConfig returns undefined =>
// rotation falls back to stored remoteConfig (or local) and still starts.
describe('Remote config fetch fallback', () => {
  let started = 0;
  beforeEach(() => {
    const backing: Record<string, any> = {
      useRemoteConfig: true,
      remoteSettings: { configUrl: 'https://conf', configReloadIntervalMinutes: 10 },
      remoteConfig: { pages: [{ url: 'https://one' }] }
    };
  installBaseChromeMocks();
  installChromeWithStorage();
    // Patch storage mocks with backing store semantics
    (chrome as any).storage.local.get = async (key: any) => {
      if (Array.isArray(key)) { const o:any={}; key.forEach(k=> o[k]=backing[k]); return o; }
      if (typeof key === 'string') return { [key]: backing[key] };
      return backing;
    };
    (chrome as any).storage.local.set = async (vals: any) => { Object.assign(backing, vals); };
  });

  it('falls back to stored config when fetch returns undefined', async () => {
    const http = new CustomHttpClient();
    const validator = new ConfigValidatorService();
    const toolbar = new ToolbarManagerService();
    const configService = new ConfigService(http, validator, new StorageService());
    spyOn(configService as any, 'fetchRemoteConfig').and.resolveTo(undefined);
    const rot = new RotationService(
      http,
      validator,
      toolbar,
      configService,
      undefined,
      undefined,
      new TabManagerService(new MetricsService()),
      undefined,
      undefined,
      new SchedulerService(),
      new StorageService(),
      new MetricsService()
    );
    spyOn(rot as any, 'createTabs').and.callFake(async () => {});
    spyOn(rot as any, 'tryFullscreen').and.callFake(async () => {});
    spyOn(rot as any, 'startRotationProcess').and.callFake(async () => { started++; });

    await (rot as any).initialize();
    expect(started).toBeGreaterThan(0);
  });
});
