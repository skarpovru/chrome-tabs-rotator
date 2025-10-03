/* Simple harness to exercise TabManagerService create/remove/invariant logic with a mocked chrome API */
import { TabManagerService } from '../src/background/tab-manager.service';
// Provide minimal chrome type to satisfy TS where needed
declare const chrome: any;
import { TabConfig } from '../src/app/models/tab-config.model';
import { TabsConfig } from '../src/app/models/tabs-config.model';

// Minimal chrome mock (only what TabManagerService uses)
const tabs: any[] = [];
let nextId = 100;
(globalThis as any).chrome = {
  tabs: {
    async create(opts: { url: string; active: boolean; windowId?: number }) {
      const tab = { id: nextId++, url: opts.url, active: opts.active, windowId: opts.windowId ?? 1, discarded: false, title: opts.url };
      tabs.push(tab);
      return tab;
    },
    async get(id: number) {
      const t = tabs.find(t => t.id === id);
      if (!t) throw new Error('No such tab');
      return t;
    },
    async remove(id: number|number[]) {
      const arr = Array.isArray(id) ? id : [id];
      for (const i of arr) {
        const idx = tabs.findIndex(t => t.id === i);
        if (idx >= 0) tabs.splice(idx, 1);
      }
    }
  },
  runtime: { sendMessage() { /* noop for metrics */ } }
};

async function run() {
  const mgr = new TabManagerService();
  // Seed a pseudo config
  mgr.tabsConfig = new TabsConfig();
  const pages = ['https://a.test','https://b.test','https://c.test'];
  for (let i = 0; i < pages.length; i++) {
    const cfg = new TabConfig({ page: { url: pages[i], delaySeconds: 5, reloadIntervalSeconds: 0 } as any, active: i === 0 });
    mgr.tabsConfig.tabs.push(cfg);
    await mgr.createTab(cfg, async () => {});
  }
  // Artificially add extra spoof tab IDs to tracked list
  const tracked = mgr.tabsConfig.tabs.map(t => t.tabId);
  // Add duplicates and fake IDs
  tracked.push(tracked[0]);
  tracked.push(99999);
  console.log('Before enforce:', { tracked: [...tracked], tabs: tabs.map(t=>t.id) });
  const updated = await mgr.enforceInvariant({ trackedIds: tracked });
  console.log('After enforce:', { updated, existingTabs: tabs.map(t=>t.id) });
}
run().catch(e => { console.error(e); process.exit(1); });
