// <reference types="jasmine" />
import { RotationService } from '../rotation.service';
import { CustomHttpClient } from '../custom-http-client.service';
import { ConfigValidatorService, ToolbarManagerService } from '../../app/services';
import { installChromeWithStorage } from './test-helpers/rotation-service-harness';

describe('RotationService - Adopt existing tabs to prevent duplicates', () => {
  let service: RotationService; let tabs: Record<number, any> = {}; let idCounter=400;
  beforeEach(async ()=>{
    tabs={}; idCounter=400;
    // Pre-create two tabs that match config pages (simulate session restore)
    const preA = ++idCounter; tabs[preA] = { id: preA, url: 'https://adopt.test/a', windowId:1 };
    const preB = ++idCounter; tabs[preB] = { id: preB, url: 'https://adopt.test/b', windowId:1 };
    installChromeWithStorage({
      tabs: {
        create: jasmine.createSpy('create').and.callFake(async (opts:any)=> { const id=++idCounter; const t={ id, url: opts.url, windowId:1 }; tabs[id]=t; return t; }),
        get: jasmine.createSpy('get').and.callFake(async(id:number)=> { const t=tabs[id]; if(!t) throw new Error('missing'); return t; }),
        query: jasmine.createSpy('query').and.callFake(async ()=> Object.values(tabs)),
        update: jasmine.createSpy('update').and.callFake(async(id:number)=> tabs[id]),
        remove: jasmine.createSpy('remove').and.callFake(async(id:number)=> { delete tabs[id]; }),
        highlight: jasmine.createSpy('highlight').and.resolveTo({} as any),
        onUpdated: { addListener: () => {}, removeListener: () => {} }
      },
      windows: { getLastFocused: jasmine.createSpy('getLastFocused').and.resolveTo({ id:1 }) },
      alarms: { create: jasmine.createSpy('alarm.create'), clear: jasmine.createSpy('alarm.clear'), getAll: jasmine.createSpy('alarm.getAll').and.resolveTo([]) }
    });
    service = new RotationService(new CustomHttpClient(), new ConfigValidatorService(), new ToolbarManagerService());
    const cfg = { pages: [ { url:'https://adopt.test/a', delaySeconds:2, reloadIntervalSeconds:0 }, { url:'https://adopt.test/b', delaySeconds:2, reloadIntervalSeconds:0 } ], isFullscreen:false, preventWindowFocus:false } as any;
    spyOn((service as any).configService, 'loadFromStorage').and.resolveTo({ loadedConfig: cfg, loadedRemoteSettings: undefined });
    await service.initialize();
  });
  it('does not create duplicate tabs when matching URLs exist', () => {
    const tabIds = Object.keys(tabs).map(k=>Number(k));
    // Expect only original preA and preB for those URLs (no new creates using same URL)
    const urlCounts: Record<string, number> = {};
    for (const t of Object.values(tabs)) { urlCounts[t.url] = (urlCounts[t.url]||0)+1; }
    expect(urlCounts['https://adopt.test/a']).toBe(1);
    expect(urlCounts['https://adopt.test/b']).toBe(1);
  });
});
