/*
 * Test chrome API baseline mocks for background specs.
 * Provides lightweight in-memory implementations for the subset of the
 * Chrome Extension APIs exercised by rotation/background services.
 * Currently covered:
 *  - alarms: create/clear/get/getAll (records scheduled alarms for assertions)
 *  - tabs: create/get/remove/query/update (query supports windowId + url filters)
 *  - action: setBadgeText / setBadgeBackgroundColor / setIcon (async no-op)
 *  - windows: getLastFocused (always returns windowId=1)
 *  - storage.local: naive key-value store (overrideable per test)
 *  - runtime: lastError placeholder + sendMessage/getContexts no-ops
 *
 * Returned helper object exposes createdTabs / createdAlarms / clearedAlarms so
 * tests can assert on side‑effects without relying on brittle console output.
 */
export interface ChromeMockOptions {
  tabsCreateImpl?: (createProperties: any) => Promise<any>;
}

export function installBaseChromeMocks(opts: ChromeMockOptions = {}) {
  const createdTabs: any[] = [];
  const createdAlarms: { name: string; when?: number; periodInMinutes?: number }[] = [];
  const clearedAlarms: string[] = [];
  const tabsCreate = opts.tabsCreateImpl || (async (props: any) => {
    const tab = { id: Math.floor(Math.random()*1000)+100, windowId: 1, ...props };
    createdTabs.push(tab); return tab; });

  // Basic in-memory tab store to support query/update
  function queryTabs(queryInfo: any): any[] {
    // Very small subset: match by url or windowId if provided
    return createdTabs.filter(t => {
      if (queryInfo?.windowId != null && t.windowId !== queryInfo.windowId) return false;
      if (queryInfo?.url) {
        const urls = Array.isArray(queryInfo.url) ? queryInfo.url : [queryInfo.url];
        if (!urls.includes(t.url)) return false;
      }
      return true;
    });
  }

  async function updateTab(id: number, updateProps: any) {
    const idx = createdTabs.findIndex(t => t.id === id);
    if (idx >= 0) {
      createdTabs[idx] = { ...createdTabs[idx], ...updateProps };
      return createdTabs[idx];
    }
    // Simulate chrome error path; consumer may check runtime.lastError
    (globalThis as any).chrome.runtime.lastError = { message: 'No tab with id ' + id };
    return undefined;
  }

  (globalThis as any).chrome = {
    alarms: {
      create: (name: string, info: any) => { createdAlarms.push({ name, when: info?.when, periodInMinutes: info?.periodInMinutes }); },
      clear: async (name: string) => { clearedAlarms.push(name); return true; },
      getAll: async () => createdAlarms.map(a => ({ name: a.name, scheduledTime: a.when, periodInMinutes: a.periodInMinutes })),
      get: async (name: string) => {
        const a = createdAlarms.find(a => a.name === name);
        return a ? { name: a.name, scheduledTime: a.when, periodInMinutes: a.periodInMinutes } : undefined;
      },
      onAlarm: { addListener: () => {} }
    },
    storage: { local: { get: async (key: any) => {
      if (typeof key === 'string') return { [key]: undefined }; return {}; }, set: async () => {}, remove: async () => {} } },
    windows: { getLastFocused: async () => ({ id: 1 }), update: async () => {} },
    tabs: {
      create: tabsCreate,
      get: async (id:number) => createdTabs.find(t => t.id === id) || { id, windowId: 1 },
      remove: async (ids: number | number[]) => {
        const idArr = Array.isArray(ids) ? ids : [ids];
        for (const id of idArr) {
          const i = createdTabs.findIndex(t => t.id === id);
            if (i >= 0) createdTabs.splice(i,1);
        }
      },
      query: async (queryInfo: any) => queryTabs(queryInfo),
      update: updateTab,
      onUpdated: { addListener: () => {} }
    },
  // Provide action API with promise-returning setIcon (awaited in ToolbarManagerService)
  action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, setIcon: async (_opts: any) => { return; } },
    runtime: { lastError: null, sendMessage: () => {}, getContexts: async () => [] }
  } as any;
  return { createdTabs, createdAlarms, clearedAlarms };
}
