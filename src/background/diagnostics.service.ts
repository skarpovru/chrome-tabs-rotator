import { TabConfig } from '../app/models';

/**
 * DiagnosticsService
 * ------------------
 * Assembles diagnostics payload. Initially a thin wrapper; logic will migrate
 * from RotationService.getDiagnostics.
 */
export interface FocusAttemptSnapshot {
  at: number | null;
  source: string | null;
  windowId: number | null;
  success: boolean | null;
  error: string | null;
}

export interface RotationDiagnosticsState {
  lastRotationAt: number | null;
  nextRotationDueAt: number | null;
  lastActivatedTabId: number | null;
  lastActivatedPageIndex: number | null;
  rotationCycle: number;
  stallCount: number;
  lastStallAt: number | null;
  lastStallReason: string | null;
  severity?: 'ok' | 'warn' | 'error';
  badgeColor?: string;
  preservedResumeAt?: number | null;
  heartbeatAt?: number | null;
}

export class DiagnosticsService {
  buildPagesMeta(tabs: TabConfig[]) {
    return tabs.map((t, i) => ({
      index: i,
      url: t.page?.url,
      tabId: t.tabId,
      nextTabId: t.nextTabId,
      delaySeconds: t.page?.delaySeconds,
      ready: { primary: t.tabIdReady, next: t.nextTabIdReady },
    }));
  }

  async assembleDiagnostics(params: {
    tabs: TabConfig[] | undefined;
    isRotating: boolean;
    currentIndex: number;
    rotation: RotationDiagnosticsState;
    focus: FocusAttemptSnapshot;
    rotationStateTabIds: number[];
    windowId: number | undefined;
    enforceResumeAt: number;
    metricsCounters?: Record<string, number>;
    activationHistory?: any[];
    lastActivationSuccessAt?: number | null;
  }): Promise<any> {
    const manifest = chrome.runtime.getManifest();
    const alarms = await chrome.alarms.getAll();
    let wndId = params.windowId;
    try {
      const wnd = await chrome.windows.getLastFocused();
      wndId = wnd?.id ?? wndId;
    } catch {}
    let tabsInWindow: chrome.tabs.Tab[] = [];
    try {
      tabsInWindow = await chrome.tabs.query(wndId ? { windowId: wndId } : {});
    } catch {}

    const allowed = new Set<number>();
    if (params.isRotating && params.tabs?.length) {
      for (const t of params.tabs) {
        if (t.tabId > 0) allowed.add(t.tabId);
        if (t.nextTabId > 0) allowed.add(t.nextTabId);
      }
    }
    const tracked = [...new Set(params.rotationStateTabIds ?? [])];
    const extras = tracked.filter((id) => !allowed.has(id));

    return {
      version: manifest['version'],
      isRotating: params.isRotating,
      currentIndex: params.currentIndex,
      pagesConfigured: params.tabs?.length ?? 0,
      lastRotationAt: params.isRotating ? params.rotation.lastRotationAt : null,
      nextRotationDueAt: params.isRotating ? params.rotation.nextRotationDueAt : null,
      lastRotationAgeSeconds:
        params.isRotating && params.rotation.lastRotationAt
          ? Math.round((Date.now() - params.rotation.lastRotationAt) / 1000)
          : null,
      lastFocusAttemptAt: params.focus.at,
      lastFocusAttemptSource: params.focus.source,
      lastFocusAttemptWindowId: params.focus.windowId,
      lastFocusAttemptSucceeded: params.focus.success,
      lastFocusAttemptError: params.focus.error,
      lastActivatedTabId: params.rotation.lastActivatedTabId,
      lastActivatedPageIndex: params.rotation.lastActivatedPageIndex,
      rotationCycle: params.rotation.rotationCycle,
      stallCount: params.rotation.stallCount,
      lastStallAt: params.rotation.lastStallAt,
      lastStallReason: params.rotation.lastStallReason,
      pagesMeta: this.buildPagesMeta(params.tabs ?? []),
      trackedTabIds: tracked,
      allowedIds: [...allowed],
      extraTrackedIds: extras,
      windowId: wndId ?? null,
      windowTabCount: tabsInWindow.length,
      windowTabsPreview: tabsInWindow.slice(0, 15).map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        discarded: t.discarded,
      })),
      alarms: alarms.map((a) => ({
        name: a.name,
        scheduledTime: a.scheduledTime,
        periodInMinutes: a.periodInMinutes,
      })),
      enforceResumeAt: params.enforceResumeAt,
      metrics: params.metricsCounters || null,
      activationHistory: params.activationHistory ?? [],
      lastActivationSuccessAt: params.lastActivationSuccessAt ?? null,
      activationSuccessAgeSeconds: params.lastActivationSuccessAt ? Math.round((Date.now() - params.lastActivationSuccessAt) / 1000) : null,
      now: Date.now(),
    };
  }
}
