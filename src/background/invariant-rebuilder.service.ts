import { ConfigService } from './config.service';
import { TabManagerService } from './tab-manager.service';
import { TabsConfig, TabConfig, ConfigData } from '../app/models';

export interface RebuildResult {
  tabsConfig: TabsConfig;
  windowId?: number;
  enforceResumeAt: number;
  loadedConfig: ConfigData;
}

export class InvariantRebuilderService {
  constructor(private configService: ConfigService, private tabManager: TabManagerService) {}

  async rebuildTabsFromState(params: {
    rotationTrackedIds: number[] | undefined;
    existingTabsConfig?: TabsConfig;
    currentWindowId?: number;
  }): Promise<RebuildResult | null> {
    const { rotationTrackedIds, existingTabsConfig, currentWindowId } = params;
    if (existingTabsConfig?.tabs?.length) return null; // nothing to do

    const startTs = Date.now();
    const { loadedConfig } = await this.configService.loadFromStorage();
    const trackedUnique = [...new Set(rotationTrackedIds ?? [])];
    const tabsConfig = new TabsConfig();
    let windowId = currentWindowId;

    // Fetch real tabs once to map URL->id (surviving tabs after restart). We only inspect HTTP/file pages.
    let existingTabs: chrome.tabs.Tab[] = [];
    try {
      existingTabs = await chrome.tabs.query({});
    } catch {}
    const byUrl = new Map<string, chrome.tabs.Tab[]>();
    for (const t of existingTabs) {
      if (!t.url) continue;
      const bucket = byUrl.get(t.url) || [];
      bucket.push(t);
      byUrl.set(t.url, bucket);
    }

    const matchedIds = new Set<number>();
    const unmatchedSurvivors: number[] = [];

    // Strategy:
    // 1. For each configured page, try to find a surviving tab whose id is in rotationTrackedIds AND url matches.
    // 2. If none, fall back to any surviving tab with matching URL.
    // 3. If still none, create placeholder (to be lazily created later).
    for (let i = 0; i < (loadedConfig.pages?.length ?? 0); i++) {
      const page = loadedConfig.pages[i];
      const cfg = new TabConfig({ page, active: i === 0 });
      const url = page?.url;
      let chosen: chrome.tabs.Tab | undefined;
      if (url) {
        const candidates = byUrl.get(url) || [];
        // prefer one whose id is in tracked list
        chosen = candidates.find(c => trackedUnique.includes(c.id!));
        if (!chosen) chosen = candidates[0];
      }
      if (chosen && chosen.id) {
        const exists = await this.tabManager.ensureTabExists(chosen.id);
        if (exists) {
          cfg.tabId = chosen.id; cfg.tabIdReady = true; matchedIds.add(chosen.id);
          if (windowId == null && chosen.windowId != null) windowId = chosen.windowId;
        }
      }
      tabsConfig.tabs.push(cfg);
    }

    // Anything in trackedUnique not matched is considered stale; list for diagnostics.
    for (const id of trackedUnique) if (!matchedIds.has(id)) unmatchedSurvivors.push(id);

    console.debug('[invariant-rebuilder] rebuild complete', {
      ms: Date.now() - startTs,
      pages: tabsConfig.tabs.length,
      matched: [...matchedIds],
      unmatchedTracked: unmatchedSurvivors,
    });
    // IMPORTANT: Do NOT carry forward stale tracked IDs here; returning only those actually matched.
    // RotationService will persist current tabsConfig.tabIds when tabs are (re)created. This prevents
    // anti-spam logic from considering foreign tabs or outdated IDs.
    // (No direct change needed to the shape, but comment documents intent.)
    return { tabsConfig, windowId, enforceResumeAt: Date.now() + 5000, loadedConfig };
  }

  async enforceInvariant(params: { force?: boolean; resumeAt?: number; trackedIds: number[]; tabManager: TabManagerService; tabsConfig?: TabsConfig }): Promise<number[]> {
    const { force, resumeAt, trackedIds, tabManager, tabsConfig } = params;
    if (!tabsConfig?.tabs?.length) return trackedIds;
    return await tabManager.enforceInvariant({ force, resumeAt, trackedIds });
  }
}
