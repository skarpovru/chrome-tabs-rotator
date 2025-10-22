import { RotationService } from '../rotation.service';
import { TabManagerService } from '../tab-manager.service';
import { DiagnosticsService } from '../diagnostics.service';
import { StallGuardService } from '../stall-guard.service';
import { SchedulerService } from '../scheduler.service';
import { StorageService } from '../storage.service';
import { MetricsService } from '../metrics.service';
import { CustomHttpClient } from '../custom-http-client.service';
import { ConfigValidatorService, ToolbarManagerService } from '../../app/services';
import { ConfigService } from '../config.service';
import { FocusService } from '../focus.service';
import { TabConfig } from '../../app/models';

// Minimal chrome stubs
let nextId = 2000; const tabs: any[] = []; const errorFired: number[] = [];
(globalThis as any).chrome = {
  tabs: {
    create: async (opts: any) => { const id = ++nextId; const tab = { id, windowId: 1, url: opts.url, active: !!opts.active }; tabs.push(tab); return tab; },
    update: async ()=>{}, remove: async ()=>{}, get: async (id:number)=>{ const t=tabs.find(t=>t.id===id); if(!t) throw new Error('no'); return t; }, query: async ()=>tabs,
    onUpdated: { addListener: ()=>{} }, onRemoved: { addListener: ()=>{} },
  },
  webNavigation: { onCompleted: { addListener: ()=>{} }, onErrorOccurred: { addListener: ()=>{} } },
  alarms: { clear: async()=>{}, clearAll: async()=>{}, create: ()=>{}, getAll: async()=>[], onAlarm: { addListener: ()=>{} } },
  action: { setBadgeText: ()=>{} },
  runtime: { getPlatformInfo: (cb:any)=>cb && cb() },
  storage: { local: { get: async ()=>({}), set: async ()=>{}, remove: async()=>{} } },
};
class MemStorage extends StorageService { private data: Record<string,any>={}; override async get<T>(k:string){ return this.data[k]; } override async set(o:Record<string,any>){ Object.assign(this.data,o);} }

describe('initial primary load failure immediate suspension', () => {
  it('suspends a tab after first primary load error even with default maxRetries>0', async () => {
    const rotation = new RotationService(
      new CustomHttpClient(),
      new ConfigValidatorService(),
      new ToolbarManagerService(),
      new ConfigService(new CustomHttpClient(), new ConfigValidatorService()),
      undefined,
      new FocusService(),
      new TabManagerService(new MetricsService()),
      new DiagnosticsService(),
      new StallGuardService(),
      new SchedulerService(),
      new MemStorage(),
      new MetricsService()
    );

    const good = new TabConfig({ page: { url: 'https://good.initial.test', delaySeconds: 5, reloadIntervalSeconds: 0 } as any });
    const bad = new TabConfig({ page: { url: 'https://fail-initial.test', delaySeconds: 5, reloadIntervalSeconds: 0 } as any });

    await (rotation as any).tabManager.createTab(good, async()=>{});
    await (rotation as any).tabManager.createTab(bad, async()=>{});
    const tm = (rotation as any).tabManager;
  if(!tm.tabsConfig.tabs.includes(good)) tm.tabsConfig.tabs.push(good);
  if(!tm.tabsConfig.tabs.includes(bad)) tm.tabsConfig.tabs.push(bad);
  (rotation as any)._tabsConfig = tm.tabsConfig;
    (rotation as any).rotationState.isRotating = true;
    (rotation as any).rotationState.tabIds = tm.tabsConfig.tabs.flatMap((t: any)=>[t.tabId,t.nextTabId]).filter((id:number)=>id>0);

    // Simulate error BEFORE any successful completion
    await (rotation as any).onHandleError(bad.tabId, bad.page.url);
    expect(bad.suspended).toBeTrue();
    expect(bad.primaryCompleteObserved).not.toBeTrue();
  });
});
