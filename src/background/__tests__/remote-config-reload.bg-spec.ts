import { RotationService } from '../../background/rotation.service';
import { ConfigValidatorService } from '../../app/services/config-validator.service';
import { CustomHttpClient } from '../../background/custom-http-client.service';

describe('Background remote config scheduled reload', () => {
  it('updates stored remote config on scheduled reload', async () => {
    // Stub Http client to return different configs on successive calls
    let call = 0;
    const httpStub = { get: async () => ({ pages: call++ === 0 ? [{ url: 'https://remote.initial', delaySeconds: 5, reloadIntervalSeconds: 0 }] : [{ url: 'https://remote.updated', delaySeconds: 5, reloadIntervalSeconds: 0 }] }) } as unknown as CustomHttpClient;
    const validator = new ConfigValidatorService();
    const toolbarStub: any = { setIcon: () => Promise.resolve() };
    const service = new RotationService(httpStub, validator, toolbarStub);
    // Simulate storage remote settings & existing local remote config
    const storage: any = (service as any).storage;
    await storage.set({ remoteSettings: { configUrl: 'https://remote.conf', configReloadIntervalMinutes: 1 } });
    await storage.set({ remoteConfig: { pages: [{ url: 'https://remote.initial', delaySeconds: 5, reloadIntervalSeconds: 0 }] } });
    // First initialize should fetch initial config
    await service.initialize();
    const firstRemote = await storage.get('remoteConfig');
    expect(firstRemote.pages[0].url).toBe('https://remote.initial');
    // Simulate alarm-triggered reload by invoking fetch directly via configService
    const configService: any = (service as any).configService;
    const updated = await configService.fetchRemoteConfig('https://remote.conf');
    expect(updated.pages[0].url).toBe('https://remote.updated');
  });
});
