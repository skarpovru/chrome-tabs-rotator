// <reference types="jasmine" />
import { RotationService } from '../rotation.service';
import { ConfigValidatorService, ToolbarManagerService } from '../../app/services';
import { CustomHttpClient } from '../custom-http-client.service';
import { installChromeWithStorage } from './test-helpers/rotation-service-harness';
import { StartupRecoveryService } from '../startup-recovery.service';
import { RotationState } from '../../app/models';

class StartupRecoveryStub extends StartupRecoveryService {
  constructor() { super({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any); }
  override async rescheduleIfNeeded(rotationState: RotationState): Promise<{ reinitNeeded: boolean }> {
    return { reinitNeeded: rotationState.isRotating && (!rotationState.tabIds || rotationState.tabIds.length === 0) };
  }
  // Simplify restore: return empty state
  override async restore(): Promise<any> { return { rotationState: new RotationState(), currentIndex: 0, debugActivationLogging: false }; }
}

describe('RotationService auto reinitialize after reschedule', () => {
  let service: RotationService;
  let startup: StartupRecoveryStub;

  beforeEach(() => {
    installChromeWithStorage({
      tabs: {
        create: jasmine.createSpy('create').and.resolveTo({ id: 101, windowId: 1, url: 'https://x.example' }),
        get: jasmine.createSpy('get').and.callFake(async (id:number)=> ({ id, windowId: 1, url: 'https://x.example' })),
        onUpdated: { addListener: () => {}, removeListener: () => {} }
      }
    });
    startup = new StartupRecoveryStub();
    service = new RotationService(
      new CustomHttpClient(),
      new ConfigValidatorService(),
      new ToolbarManagerService(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    );
    // Force internal startupRecovery to our stub
    (service as any).startupRecovery = startup;
    // Provide a minimal config in storage fetch path
    const storage = (service as any).storage;
    spyOn(storage, 'get').and.callFake(async (k: string) => {
      if (k === 'config') return { pages: [{ url: 'https://x.example', delaySeconds: 5, reloadIntervalSeconds: 0 }], isFullscreen: false, preventWindowFocus: false };
      return undefined;
    });
    const configService = (service as any).configService;
    spyOn(configService, 'loadFromStorage').and.resolveTo({ loadedConfig: { pages: [{ url: 'https://x.example', delaySeconds: 5, reloadIntervalSeconds: 0 }], isFullscreen: false, preventWindowFocus: false }, loadedRemoteSettings: undefined, useRemote: false });
  });

  it('calls initialize when reschedule indicates reinitNeeded', async () => {
    const rotationState = (service as any).rotationState as RotationState;
    rotationState.isRotating = true;
    rotationState.tabIds = []; // triggers reinitNeeded in stub
    const initSpy = spyOn(service as any, 'initialize').and.callThrough();
    await service.rescheduleIfNeeded();
    expect(initSpy).toHaveBeenCalled();
  });
});
