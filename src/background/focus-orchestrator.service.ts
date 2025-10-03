import { ConfigData, TabConfig } from '../app/models';
import { FocusService } from './focus.service';
import { MetricsService } from './metrics.service';

export interface FocusAttemptRecord {
  at: number | null;
  source: string | null;
  windowId: number | null;
  success: boolean | null;
  error: string | null;
}

export class FocusOrchestratorService {
  private last: FocusAttemptRecord = { at: null, source: null, windowId: null, success: null, error: null };

  constructor(private focusService: FocusService, private metrics: MetricsService) {}

  get lastAttempt(): FocusAttemptRecord { return this.last; }

  private record(source: string, windowId: number | null, success: boolean, error?: string) {
    this.last = { at: Date.now(), source, windowId, success, error: error ?? null };
  }

  async attemptTabFocus(source: 'rotateTabs' | 'openNextPageTab', tabId: number, updateWindowId: (winId: number)=>void): Promise<void> {
    const before = this.focusService.last;
    await this.focusService.focusWindowForTab(source, tabId);
    const after = this.focusService.last;
    if (after && after !== before) {
      this.record(after.source, after.windowId, !!after.success, after.error || undefined);
      if (after.windowId) updateWindowId(after.windowId);
      this.metrics.recordFocusAttempt({ success: !!after.success, source: after.source || 'unknown' });
    }
  }

  async tryFullscreen(config: ConfigData, tabsConfig?: { tabs?: TabConfig[] }, updateWindowId?: (winId: number)=>void): Promise<void> {
    if (!config.isFullscreen) return;
    try {
      const first = tabsConfig?.tabs?.[0];
      if (first?.tabId) {
        const tab = await chrome.tabs.get(first.tabId);
        if (tab?.windowId != null) {
          await chrome.windows.update(tab.windowId, { state: 'fullscreen', focused: !config.preventWindowFocus });
          if (!config.preventWindowFocus) {
            this.record('tryFullscreen', tab.windowId, true);
          } else {
            this.record('tryFullscreen', tab.windowId, false, 'suppressed-by-config');
          }
          updateWindowId?.(tab.windowId);
          console.info('[focus-orchestrator] Entered fullscreen on window', tab.windowId);
          return;
        }
      }
      if (updateWindowId && this.last.windowId != null) {
        await chrome.windows.update(this.last.windowId, { state: 'fullscreen', focused: true });
        this.record('tryFullscreen', this.last.windowId, true);
        console.info('[focus-orchestrator] Entered fullscreen on previous window', this.last.windowId);
      }
    } catch (e) {
      this.record('tryFullscreen', this.last.windowId, false, String(e));
      console.warn('[focus-orchestrator] Failed fullscreen attempt:', e);
    }
  }
}
