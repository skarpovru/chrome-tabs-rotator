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
    const tracked = [...new Set(rotationTrackedIds ?? [])];
    const tabsConfig = new TabsConfig();
    let windowId = currentWindowId;
    for (let i = 0; i < (loadedConfig.pages?.length ?? 0); i++) {
      const page = loadedConfig.pages[i];
      const cfg = new TabConfig({ page, active: i === 0 });
      const id = tracked[i];
      if (id) {
        const exists = await this.tabManager.ensureTabExists(id);
        if (exists) {
          cfg.tabId = id; cfg.tabIdReady = true; tabsConfig.tabs.push(cfg);
          if (windowId == null) {
            try { const t = await chrome.tabs.get(id); if (t?.windowId != null) windowId = t.windowId; } catch {}
          }
          continue;
        }
      }
      tabsConfig.tabs.push(cfg); // placeholder
    }
    console.debug('[invariant-rebuilder] rebuild complete in', Date.now() - startTs, 'ms size=', tabsConfig.tabs.length);
    return { tabsConfig, windowId, enforceResumeAt: Date.now() + 5000, loadedConfig };
  }

  async enforceInvariant(params: { force?: boolean; resumeAt?: number; trackedIds: number[]; tabManager: TabManagerService; tabsConfig?: TabsConfig }): Promise<number[]> {
    const { force, resumeAt, trackedIds, tabManager, tabsConfig } = params;
    if (!tabsConfig?.tabs?.length) return trackedIds;
    return await tabManager.enforceInvariant({ force, resumeAt, trackedIds });
  }
}
