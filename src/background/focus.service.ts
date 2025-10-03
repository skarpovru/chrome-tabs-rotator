import { ConfigData } from '../app/models';

/**
 * FocusService
 * -----------------
 * Encapsulates window focusing behavior & diagnostics.
 * RotationService will provide callbacks to record attempts.
 */
export interface FocusAttemptRecord {
  at: number;
  source: string;
  windowId: number | null;
  success: boolean;
  error?: string | null;
}

export class FocusService {
  private lastAttempt?: FocusAttemptRecord;
  private windowId?: number;
  private preventWindowFocus = false;

  setConfig(cfg?: ConfigData) {
    this.preventWindowFocus = !!cfg?.preventWindowFocus;
  }

  getWindowId(): number | undefined {
    return this.windowId;
  }

  get last(): FocusAttemptRecord | undefined {
    return this.lastAttempt;
  }

  /** Attempt to focus the window containing given tab. */
  async focusWindowForTab(source: string, tabId: number): Promise<void> {
    if (this.preventWindowFocus) {
      this.record(source, this.windowId ?? null, false, 'suppressed-by-config');
      return;
    }
    try {
      if (this.windowId == null) {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab?.windowId != null) this.windowId = tab.windowId;
        } catch {}
      }
      if (this.windowId != null) {
        try {
          await chrome.windows.update(this.windowId, { focused: true });
          this.record(source, this.windowId, true);
        } catch (focusErr) {
          this.record(source, this.windowId, false, String(focusErr));
        }
      } else {
        this.record(source, null, false, 'no-window-id');
      }
    } catch (outer) {
      this.record(source, this.windowId ?? null, false, String(outer));
    }
  }

  /** Direct fullscreen attempt (used during init). */
  async applyFullscreen(source: string, tabId?: number, forceFocus = true) {
    try {
      if (tabId) {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.windowId != null) {
          await chrome.windows.update(tab.windowId, {
            state: 'fullscreen',
            focused: forceFocus && !this.preventWindowFocus,
          });
          this.windowId = tab.windowId;
          this.record(source, this.windowId, !this.preventWindowFocus);
          return;
        }
      }
      if (this.windowId != null) {
        await chrome.windows.update(this.windowId, {
          state: 'fullscreen',
          focused: forceFocus && !this.preventWindowFocus,
        });
        this.record(source, this.windowId, !this.preventWindowFocus);
      } else {
        this.record(source, null, false, 'no-window-id');
      }
    } catch (e) {
      this.record(source, this.windowId ?? null, false, String(e));
    }
  }

  private record(source: string, windowId: number | null, success: boolean, error?: string | null) {
    this.lastAttempt = {
      at: Date.now(),
      source,
      windowId,
      success,
      error: error ?? null,
    };
  }
}
