// <reference types="jasmine" />
import { ConfigService } from '../config.service';
import { RotationService } from '../rotation.service';
import { ConfigValidatorService, ToolbarManagerService } from '../../app/services';
import { CustomHttpClient } from '../custom-http-client.service';
import { TabManagerService } from '../tab-manager.service';
import { SchedulerService } from '../scheduler.service';
import { StorageService } from '../storage.service';
import { MetricsService } from '../metrics.service';
import { installBaseChromeMocks } from './test-helpers/chrome-mock';
import { installChromeWithStorage } from './test-helpers/rotation-service-harness';

/**
 * Tests remote configuration change detection: when remote fetch yields different hash/config
 * rotation should restart (initialize called).
 */

describe('Remote config change detection', () => {
  let rotation: RotationService;
  let started = 0;

  beforeEach(() => {
    const backing: Record<string, any> = {
      useRemoteConfig: true,
      remoteSettings: { configUrl: 'https://conf', configReloadIntervalMinutes: 5 },
      remoteConfig: { pages: [{ url: 'https://one' }] }
    };
  installBaseChromeMocks();
  installChromeWithStorage();
    (chrome as any).storage.local.get = async (key: any) => {
      if (Array.isArray(key)) { const out:any={}; key.forEach(k=> out[k]=backing[k]); return out; }
      if (typeof key === 'string') return { [key]: backing[key] };
      return backing;
    };
    (chrome as any).storage.local.set = async (vals: any) => { Object.assign(backing, vals); };

    const http = new CustomHttpClient();
    const validator = new ConfigValidatorService();
    const toolbar = new ToolbarManagerService();
    const configService = new ConfigService(http, validator, new StorageService());
    let first = true;
    spyOn(configService as any, 'fetchRemoteConfig').and.callFake(async () => {
      // Return different object first call to simulate change
      if (first) { first = false; return { pages: [{ url: 'https://one' }, { url: 'https://two' }] }; }
      return { pages: [{ url: 'https://one' }, { url: 'https://two' }] };
    });
    rotation = new RotationService(
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
    spyOn(rotation as any, 'createTabs').and.callFake(async () => {});
    spyOn(rotation as any, 'tryFullscreen').and.callFake(async () => {});
    spyOn(rotation as any, 'startRotationProcess').and.callFake(async () => { started++; });
  });

  it('re-initializes on remote hash change', async () => {
    // simulate alarm firing which triggers remote fetch and restart if changed
    await rotation.onConfigReloadAlarm(); // should detect change and start rotation
    expect(started).toBeGreaterThan(0);
  });
});
