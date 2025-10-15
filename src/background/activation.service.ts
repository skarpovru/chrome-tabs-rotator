import { ActivationDiagnosticsService } from './activation-diagnostics.service';
import { FocusOrchestratorService } from './focus-orchestrator.service';

export type ActivationSource = 'rotateTabs' | 'openNextPageTab';

export interface ActivationServiceDeps {
  diagnostics: ActivationDiagnosticsService;
  focusOrchestrator: FocusOrchestratorService;
  debugFlagProvider: () => boolean;
  onActivated: (info: { tabId: number; pageIndex: number }) => void;
}

/**
 * Encapsulates robust tab activation with multi-stage fallback + diagnostics.
 * Keeps RotationService thin; has no knowledge of rotation state beyond callbacks.
 */
export class ActivationService {
  constructor(private deps: ActivationServiceDeps) {}

  public async activateTabWithFallback(
    targetId: number,
    pageIndex: number,
    source: ActivationSource
  ): Promise<boolean> {
    this.deps.diagnostics.setLastError(null);
    const attempt = async (stage: string): Promise<boolean> => {
      try {
        let beforeActiveId: number | undefined = undefined;
        try {
          const allWins = await chrome.windows.getAll({ populate: true });
          for (const w of allWins) {
            const act = w.tabs?.find((t) => t.active);
            if (act?.id) { beforeActiveId = act.id; break; }
          }
        } catch {}
  const updated = await chrome.tabs.update(targetId, { active: true });
        const winId = updated?.windowId ?? (await (async () => {
          try { const t = await chrome.tabs.get(targetId); return t?.windowId; } catch { return undefined; }
        })());
        await new Promise((r) => setTimeout(r, 60));
        const actives = await chrome.tabs.query({ windowId: winId, active: true });
        const active = actives?.[0];
        if (this.deps.debugFlagProvider())
          console.debug(`[activation] stage=${stage} before=${beforeActiveId} after=${active?.id} target=${targetId}`);
        if (active?.id === targetId) {
          await this.finishSuccess(stage, targetId, pageIndex, source);
          return true;
        }
        if (this.deps.debugFlagProvider())
          console.debug('[activation] fallback highlight', { targetId, activeId: active?.id });
        if (winId != null) {
          try {
            const tabsInWin = await chrome.tabs.query({ windowId: winId });
            const idx = tabsInWin.findIndex((t) => t.id === targetId);
            if (idx >= 0) {
              await chrome.tabs.highlight({ windowId: winId, tabs: idx });
              await new Promise((r) => setTimeout(r, 60));
              const again = await chrome.tabs.query({ windowId: winId, active: true });
              if (again?.[0]?.id === targetId) {
                await this.finishSuccess(stage + '-highlight', targetId, pageIndex, source);
                return true;
              }
            }
          } catch (hlErr) {
            if (this.deps.debugFlagProvider()) console.debug('[activation] highlight fallback failed', hlErr);
          }
        }
        return false;
      } catch (err) {
        this.deps.diagnostics.setLastError(String(err));
        if (this.deps.debugFlagProvider()) console.error('[activation] attempt failed', stage, err);
  void this.deps.diagnostics.record({ success: false, stage, tabId: targetId, pageIndex, error: String(err) });
        return false;
      }
    };

    let success = await attempt('update');
    if (!success) {
      await new Promise((r) => setTimeout(r, 120));
      success = await attempt('retry');
    }
    if (!success) {
      if (this.deps.debugFlagProvider())
        console.warn('[activation] ultimately failed', { targetId, pageIndex });
      void this.deps.diagnostics.record({
        success: false,
        stage: 'final',
        tabId: targetId,
        pageIndex,
        error: this.deps.diagnostics.getLastError(),
      });
    }
    return success;
  }

  private async finishSuccess(stage: string, tabId: number, pageIndex: number, source: ActivationSource) {
    await this.deps.focusOrchestrator.attemptTabFocus(source, tabId, () => {});
  void this.deps.diagnostics.record({ success: true, stage, tabId, pageIndex });
    this.deps.onActivated({ tabId, pageIndex });
    if (this.deps.debugFlagProvider())
      console.debug(`[activation] success stage=${stage} tab=${tabId} page=${pageIndex}`);
  }
}
