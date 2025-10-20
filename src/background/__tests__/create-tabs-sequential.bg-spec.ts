import { TabManagerService } from '../tab-manager.service';
import { ConfigData } from '../../app/models';

declare const global: any;
const g: any = global as any;
g.chrome = g.chrome || {};
g.chrome.tabs = g.chrome.tabs || {
  create: async (opts: any) => {
    // Simulate async variability by random small delay
    await new Promise(r => setTimeout(r, Math.floor(Math.random()*5)));
    return { id: ++g.__nextId, url: opts.url, active: opts.active, windowId: 1 };
  },
  get: async (id: number) => ({ id, url: 'https://example/'+id }),
};
if (!g.__nextId) g.__nextId = 200;

describe('TabManagerService.createTabs sequential ordering', () => {
  it('creates tabs in config order deterministically', async () => {
    const mgr = new TabManagerService();
    const cfg: ConfigData = { pages: [
      { url: 'https://order.test/1', delaySeconds: 1 },
      { url: 'https://order.test/2', delaySeconds: 1 },
      { url: 'https://order.test/3', delaySeconds: 1 },
      { url: 'https://order.test/4', delaySeconds: 1 },
    ] } as any;
    const createSequence: string[] = [];

    // Patch chrome.tabs.create to record call sequence
    const origCreate = g.chrome.tabs.create;
    g.chrome.tabs.create = async (opts: any) => {
      createSequence.push(opts.url);
      return await origCreate(opts);
    };

    await mgr.createTabs(cfg, async ()=>{}, async ()=>{});
    g.chrome.tabs.create = origCreate; // restore

    expect(createSequence).toEqual(cfg.pages!.map(p=>p.url));
    // Additional assertion: tabsConfig order maps 1:1 with config pages
    const resultingOrder = mgr.tabsConfig.tabs.map(t=>t.page?.url);
    expect(resultingOrder).toEqual(cfg.pages!.map(p=>p.url));
  });
});
