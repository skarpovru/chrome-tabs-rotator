import { ActivationDiagnosticsService } from './activation-diagnostics.service';
import { TabsConfig } from '../app/models';

/**
 * Handles countdown ticking, badge updates, storage persistence and broadcasting countdown messages.
 * Extracted from RotationService to reduce its complexity.
 */
export interface CountdownStartOptions {
  when: number;             // epoch ms when next rotation will occur
  tabsConfig?: TabsConfig;  // current tabs configuration for health badge color context
  onFinished?: () => void;  // invoked when countdown reaches zero
  compositeColorProvider?: () => string; // optional override for badge color
}

export class CountdownService {
  private interval?: any; // NodeJS.Timer | number (MV3 service worker environment)
  private lastSentSecond = -1;
  private lastMessageAt = 0;
  private lastStorageSecond = -1;

  constructor(private activationDiagnostics: ActivationDiagnosticsService) {}

  public start(opts: CountdownStartOptions) {
    this.stop();
  const { when, onFinished, tabsConfig, compositeColorProvider } = opts;
    const update = async () => {
      try {
        const remainingMs = when - Date.now();
        const seconds = Math.max(0, Math.round(remainingMs / 1000));
        const now = Date.now();
        const popupOpen = await this.isPopupContextOpen();
        const uiActive = (chrome.runtime as any).__uiActiveFlagInternal;
        if ((popupOpen || uiActive) && (now - this.lastMessageAt >= 2000 || seconds <= 1)) {
          if (seconds !== this.lastSentSecond) {
            try {
              chrome.runtime.sendMessage({ kind: 'countdown', seconds, nextAt: when }, undefined, () => {
                const _ = (chrome as any)?.runtime?.lastError; // swallow benign errors
              });
            } catch {}
            this.lastSentSecond = seconds;
            this.lastMessageAt = now;
          }
        }
        // Persist to storage at most once per second when value changes
        if (seconds !== this.lastStorageSecond) {
          try { chrome.storage.local.set({ __countdown: { seconds, nextAt: when } }); } catch {}
          this.lastStorageSecond = seconds;
        }
        // Badge update
        try {
          if (seconds > 0) {
            const text = seconds < 1000 ? String(seconds) : '999';
            chrome.action.setBadgeText({ text });
            const healthColor = compositeColorProvider?.() || this.activationDiagnostics.computeHealthBadgeColor(tabsConfig);
            chrome.action.setBadgeBackgroundColor({ color: healthColor });
          } else {
            chrome.action.setBadgeText({ text: '' });
            this.stop();
            onFinished?.();
          }
        } catch {}
      } catch {
        // Best-effort; ignore errors
      }
    };
    update();
    this.interval = setInterval(update, 1000);
  }

  public stop() {
    if (this.interval) {
      try { clearInterval(this.interval); } catch {}
      this.interval = undefined;
    }
    this.lastSentSecond = -1;
    this.lastMessageAt = 0;
    this.lastStorageSecond = -1;
  }

  private async isPopupContextOpen(): Promise<boolean> {
    try {
      const contexts = await (chrome as any).runtime.getContexts?.({});
      if (Array.isArray(contexts)) {
        return contexts.some((c: any) => c.contextType === 'POPUP');
      }
    } catch {}
    return false;
  }
}
