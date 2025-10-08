import { TabConfig, TabsConfig, ConfigData } from '../app/models';
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
      const tab = await chrome.tabs.create({ url: tabConfig.page.url, active: tabConfig.active, windowId: this.windowId });
      if (tabConfig.tabId > 0) { tabConfig.nextTabId = tab.id!; } else { tabConfig.tabId = tab.id!; tabConfig.tabIdReady = true; }
      if (this.windowId == null && tab.windowId != null) this.windowId = tab.windowId;
      await track(tab.id!);
      if (tab.id != null) this.ownedTabIds.add(tab.id);
      try { this.metrics?.recordTabCreation(tabConfig.page.url); } catch {}
      console.debug('[tab-manager] createTab created', { assignedPrimary: tabConfig.tabId, assignedPreload: tabConfig.nextTabId, windowId: this.windowId });
    } finally { this.creatingTabs.delete(tabConfig); }
    return tabConfig;
  }

  async createTabs(config: ConfigData, track: (id: number) => Promise<void>, waitForLoad: (t: TabConfig)=>Promise<void>): Promise<void> {
    this.tabsConfig = new TabsConfig();
    if (!config.pages?.length) return;
    console.debug('[tab-manager] createTabs start pages=', config.pages.length);
    await Promise.all(config.pages.map(async (page, idx) => {
      const tabCfg = new TabConfig({ page, active: idx === 0 });
      const created = await this.createTab(tabCfg, track);
      this.tabsConfig.tabs.push(created);
      await waitForLoad(created);
      console.debug('[tab-manager] createTabs page ready', { idx, tabId: created.tabId, nextTabId: created.nextTabId, primaryReady: created.tabIdReady, preloadReady: created.nextTabIdReady });
    }));
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
