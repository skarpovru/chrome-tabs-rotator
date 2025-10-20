import { RotationService } from '../../rotation.service';
import { ConfigValidatorService, ToolbarManagerService } from '../../../app/services';
import { CustomHttpClient } from '../../custom-http-client.service';
import { SchedulerService } from '../../scheduler.service';
import { StorageService } from '../../storage.service';
import { TabManagerService } from '../../tab-manager.service';
import { MetricsService } from '../../metrics.service';

// Simple memory-backed chrome.storage mock
export function installChromeWithStorage(overrides: any = {}) {
  const mem: Record<string, any> = {};
  // Re-use any previously installed chrome mock to avoid blowing away added namespaces
  const existing: any = (globalThis as any).chrome || {};

  // Basic in-memory tab tracking to support prune logic in RotationService
  const createdTabs: any[] = [];
  const baseTabs = overrides.tabs || existing.tabs;
  const tabs = baseTabs ? { ...baseTabs } : {} as any;
  if (!tabs.create) {
    tabs.create = async (opts: any) => {
      const tab = { id: Math.floor(Math.random() * 1000) + 100, windowId: 1, active: !!opts.active, url: opts.url };
      createdTabs.push(tab);
      return tab;
    };
  } else {
    // Wrap provided create to also record
    const origCreate = tabs.create;
    tabs.create = async (...args: any[]) => {
      const tab = await origCreate(...args);
      if (tab && createdTabs.every(t => t.id !== tab.id)) createdTabs.push(tab);
      return tab;
    };
  }
  if (!tabs.get) tabs.get = async (id: number) => createdTabs.find(t => t.id === id) || { id, windowId: 1 };
  if (!tabs.update) tabs.update = async (id: number, _opts: any) => {
    const t = createdTabs.find(t => t.id === id); if (!t) throw new Error('No tab with id'); return t;
  };
  if (!tabs.query) tabs.query = async (queryInfo: any) => {
    // Minimal filtering used by tests: windowId & url (string or array). Empty query returns all.
    return createdTabs.filter(t => {
      if (queryInfo?.windowId != null && t.windowId !== queryInfo.windowId) return false;
      if (queryInfo?.url) {
        const urls = Array.isArray(queryInfo.url) ? queryInfo.url : [queryInfo.url];
        if (!urls.includes(t.url)) return false;
      }
      return true;
    });
  };
  if (!tabs.remove) tabs.remove = async (ids: number | number[]) => {
    const arr = Array.isArray(ids) ? ids : [ids];
    for (const id of arr) {
      const i = createdTabs.findIndex(t => t.id === id);
      if (i >= 0) createdTabs.splice(i, 1);
    }
  };
  if (!tabs.onUpdated) tabs.onUpdated = { addListener: () => {}, removeListener: () => {} };

  (globalThis as any).chrome = {
    ...existing,
    ...overrides,
    alarms: overrides.alarms || existing.alarms || { create: () => {}, clear: async () => true, getAll: async () => [], get: async () => undefined },
    windows: overrides.windows || existing.windows || { getLastFocused: async () => ({ id: 1 }) },
    tabs,
    action: overrides.action || existing.action || { setBadgeText: () => {}, setBadgeBackgroundColor: () => {}, setIcon: () => {} },
    runtime: overrides.runtime || existing.runtime || { lastError: null, sendMessage: () => {}, getContexts: async () => [] },
    storage: overrides.storage || existing.storage || { local: { get: async (k:any) => {
      if (Array.isArray(k)) { const out: any = {}; for (const key of k) out[key] = mem[key]; return out; } if (typeof k === 'string') return { [k]: mem[k] }; return {}; }, set: async (vals: any) => { Object.assign(mem, vals); }, remove: async (k:any) => { const arr = Array.isArray(k)? k:[k]; for (const key of arr) delete mem[key]; } } }
  } as any;
  return { storage: mem, createdTabs };
}

export interface RotationHarnessOptions {
  config?: any;
  remoteSettings?: any;
}

export function createRotationServiceHarness(opts: RotationHarnessOptions = {}) {
  installChromeWithStorage();
  const http = new CustomHttpClient();
  const validator = new ConfigValidatorService();
  const toolbar = new ToolbarManagerService();
  const configServiceStub = {
    loadFromStorage: async () => ({
      loadedConfig: opts.config ?? { pages: [] },
      loadedRemoteSettings: opts.remoteSettings ?? {},
      useRemote: false,
    })
  } as any;
  const service = new RotationService(
    http,
    validator,
    toolbar,
    configServiceStub,
    undefined,
    undefined,
    new TabManagerService(new MetricsService()),
    undefined,
    undefined,
    new SchedulerService(),
    new StorageService(0),
    new MetricsService()
  );
  return { service };
}
