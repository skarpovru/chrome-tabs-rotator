/// <reference types="chrome-types" />
import { TabConfig, TabsConfig, ConfigData } from '../app/models';
import { canonicalizeUrl } from './url.util';
import { MetricsService } from './metrics.service';

/**
 * TabManagerService
 * -----------------
 * Handles creation, tracking, removal, and invariant enforcement of tabs.
 */
export class TabManagerService {
  tabsConfig: TabsConfig = new TabsConfig();
  private creatingTabs = new WeakSet<TabConfig>();
  private static readonly MAX_TABS_PER_PAGE = 2;
  private windowId?: number;
  /** Set of tab IDs explicitly created by the extension (ownership used to avoid closing user tabs). */
  private ownedTabIds = new Set<number>();
  constructor(private metrics?: MetricsService) {}

  /**
   * Ensures a TabConfig is present in tabsConfig.tabs (idempotent). This allows callers that invoke
   * createTab() directly (outside of bulk createTabs()) to have the created tab tracked, which some
   * invariants / diagnostics / suspension logic depend on. Duplicate objects or same page URL will
   * not be inserted twice.
   */
  private registerIfMissing(tabConfig: TabConfig) {
    if (!tabConfig) return;
    if (!this.tabsConfig?.tabs) this.tabsConfig = new TabsConfig();
    const targetCanonical = canonicalizeUrl(tabConfig.page?.url);
    const already = this.tabsConfig.tabs.some(t => {
      if (t === tabConfig) return true;
      const existingCanonical = canonicalizeUrl(t.page?.url);
      return !!existingCanonical && existingCanonical === targetCanonical;
    });
    if (!already) {
      this.tabsConfig.tabs.push(tabConfig);
      try { console.debug('[tab-manager] auto-registered tabConfig', { url: tabConfig.page?.url }); } catch {}
    }
  }

  /** Marks a collection of tab IDs as owned (used after browser restart to adopt surviving rotation tabs). */
  adoptOwnership(ids: number[] | undefined) {
    if (!ids) return;
    for (const id of ids) if (id && id > 0) this.ownedTabIds.add(id);
  }

  get window(): number | undefined { return this.windowId; }
  set window(id: number | undefined) { this.windowId = id; }

  async ensureTabExists(tabId?: number): Promise<boolean> {
    if (!tabId || tabId <= 0) return false;
    try { await chrome.tabs.get(tabId); return true; } catch { return false; }
  }

  async createTab(tabConfig: TabConfig, track: (id: number) => Promise<void>): Promise<TabConfig> {
    if (!tabConfig?.page?.url) return tabConfig;
    if (this.creatingTabs.has(tabConfig)) return tabConfig;

    if (tabConfig.nextTabId > 0 && !(await this.ensureTabExists(tabConfig.nextTabId))) {
      tabConfig.nextTabId = 0; tabConfig.nextTabIdReady = false;
    }
    if (tabConfig.tabId > 0 && !(await this.ensureTabExists(tabConfig.tabId))) {
      tabConfig.tabId = 0; tabConfig.tabIdReady = false;
    }
    if (tabConfig.nextTabId > 0) return tabConfig;

    try {
      this.creatingTabs.add(tabConfig);
      console.debug('[tab-manager] createTab begin', { existingPrimary: tabConfig.tabId, preload: tabConfig.nextTabId, url: tabConfig.page.url, active: tabConfig.active });
      let tab;
      try {
        // Never activate a newly created preload; only the very first primary (tabId not yet assigned) may be active.
        const shouldActivate = tabConfig.tabId > 0 ? false : !!tabConfig.active;
        // If we are creating a preload (primary already exists), try to place it right after primary
        let createIndex: number | undefined = undefined;
        if (tabConfig.tabId > 0) {
          try {
            const winTabs = await chrome.tabs.query({ windowId: this.windowId });
            const primaryIdx = winTabs.findIndex((t: any) => t.id === tabConfig.tabId);
            if (primaryIdx >= 0) createIndex = primaryIdx + 1;
          } catch {}
        }
        tab = await chrome.tabs.create({ url: tabConfig.page.url, active: shouldActivate, windowId: this.windowId, index: createIndex });
      } catch (e) {
        try { (this as any).__lastCreateError = String(e); } catch {}
        console.error('[tab-manager] createTab chrome.tabs.create failed', e);
        throw e;
      }
      if (tabConfig.tabId > 0) { tabConfig.nextTabId = tab.id!; } else { tabConfig.tabId = tab.id!; tabConfig.tabIdReady = true; }
      if (this.windowId == null && tab.windowId != null) this.windowId = tab.windowId;
      await track(tab.id!);
      if (tab.id != null) this.ownedTabIds.add(tab.id);
      try { this.metrics?.recordTabCreation(tabConfig.page.url); } catch {}
      console.debug('[tab-manager] createTab created', { assignedPrimary: tabConfig.tabId, assignedPreload: tabConfig.nextTabId, windowId: this.windowId });
    } finally { this.creatingTabs.delete(tabConfig); }
    // Option 2: auto-add created tab config if it is not already tracked so downstream logic (e.g. suspension) finds it.
    this.registerIfMissing(tabConfig);
    return tabConfig;
  }

  async createTabs(config: ConfigData, track: (id: number) => Promise<void>, waitForLoad: (t: TabConfig)=>Promise<void>): Promise<void> {
    this.tabsConfig = new TabsConfig();
    if (!config.pages?.length) return;
    console.debug('[tab-manager] createTabs start pages=', config.pages.length);
    // Snapshot existing tabs once to attempt URL adoption and avoid duplicates
  let existing: any[] = [];
    try { existing = await chrome.tabs.query({}); } catch {}
  const byUrl = new Map<string, any>();
    for (const t of existing) {
      if (!t.url) continue;
      const c = canonicalizeUrl(t.url);
      if (c && !byUrl.has(c)) byUrl.set(c, t);
    }
    // Sequential creation to preserve defined config order deterministically (prevents Promise.all race reordering)
    for (let idx = 0; idx < config.pages.length; idx++) {
      const page = config.pages[idx];
      const tabCfg = new TabConfig({ page, active: idx === 0 });
      // Attempt adoption: if an existing tab with same URL found, reuse as primary
      let created: TabConfig;
  const adopt = page?.url ? byUrl.get(canonicalizeUrl(page.url)!) : undefined;
      if (adopt && adopt.id) {
        tabCfg.tabId = adopt.id; tabCfg.tabIdReady = true; this.ownedTabIds.add(adopt.id);
        // Skip creation; still track
        await track(adopt.id);
        created = tabCfg;
        console.debug('[tab-manager] adopted existing tab for URL', { url: page.url, tabId: adopt.id });
      } else {
        created = await this.createTab(tabCfg, track);
      }
      // Idempotent registration (createTab already attempts registration for standalone usage)
      this.registerIfMissing(created);
      await waitForLoad(created);
      console.debug('[tab-manager] createTabs page ready', { idx, tabId: created.tabId, nextTabId: created.nextTabId, primaryReady: created.tabIdReady, preloadReady: created.nextTabIdReady });
    }
    console.debug('[tab-manager] createTabs complete totalTabs=', this.tabsConfig.tabs.length);
  }

  buildAllowedIdSet(): Set<number> {
    const allowed = new Set<number>();
    for (const t of this.tabsConfig.tabs) { if (t.tabId > 0) allowed.add(t.tabId); if (t.nextTabId > 0) allowed.add(t.nextTabId); }
    return allowed;
  }

  async removeTabs(tabIds: number[]): Promise<void> {
    if (!tabIds?.length) return;
    const toRemove: number[] = [];
    for (const id of tabIds) {
      if (!this.ownedTabIds.has(id)) continue; // never remove tabs we did not create
      if (await this.ensureTabExists(id)) toRemove.push(id);
    }
    if (toRemove.length) {
      await Promise.all(toRemove.map(id => chrome.tabs.remove(id)));
    }
  }

  /**
   * Enforce invariant:
   * - At most 2 tracked tabs per configured page (primary + preloaded)
   * - Remove extra or orphaned tracked IDs
   * Returns updated ordered tracked IDs (primary first, then preloads)
   */
  async enforceInvariant(params: {
    force?: boolean;
    resumeAt?: number;
    trackedIds: number[];
  }): Promise<number[]> {
    const { force, resumeAt, trackedIds } = params;
    if (!force && resumeAt && Date.now() < resumeAt) return trackedIds;
    if (!this.tabsConfig?.tabs?.length) return trackedIds;

    const allowed = this.buildAllowedIdSet();
    const uniqueTracked = [...new Set(trackedIds ?? [])];
    const maxAllowed = this.tabsConfig.tabs.length * TabManagerService.MAX_TABS_PER_PAGE;

    const extras: number[] = [];
    for (const id of uniqueTracked) if (!allowed.has(id)) extras.push(id);

    const extrasExisting: number[] = [];
  for (const id of extras) if (this.ownedTabIds.has(id) && (await this.ensureTabExists(id))) extrasExisting.push(id);

    const remaining = uniqueTracked.filter(id => !extrasExisting.includes(id));
    if (remaining.length > maxAllowed) extrasExisting.push(...remaining.slice(maxAllowed));

    if (extrasExisting.length) {
      console.warn('[tab-manager] Anti-spam: removing extra owned tabs', extrasExisting);
      await this.removeTabs(extrasExisting);
    }

    const newTracked: number[] = [];
    for (const id of uniqueTracked) {
      if (allowed.has(id)) newTracked.push(id);
      else if (!extrasExisting.includes(id)) {
        const exists = await this.ensureTabExists(id);
        if (exists) newTracked.push(id);
      }
    }

    // Normalize ordering: primary first then preloads
    const ordered: number[] = [];
    for (const t of this.tabsConfig.tabs) if (t.tabId > 0) ordered.push(t.tabId);
    for (const t of this.tabsConfig.tabs) if (t.nextTabId > 0) ordered.push(t.nextTabId);

    // Keep only those which remain tracked
    return ordered.filter(id => newTracked.includes(id));
  }
}
