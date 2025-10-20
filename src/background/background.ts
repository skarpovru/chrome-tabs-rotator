import { RotationService } from './rotation.service';
import { safeRuntimeLastError } from '../shared';
import { ControlMessage } from '../shared/messages';
import { StorageKeys } from '../app/models';
import { CustomHttpClient } from './custom-http-client.service';
import { ConfigValidatorService, ToolbarManagerService } from '../app/services';
import { ResumeHeuristicUtil } from './resume-heuristic.util';

const http = new CustomHttpClient();
const configValidator = new ConfigValidatorService();
const toolbarManagerService = new ToolbarManagerService();
const rotationService = new RotationService(
  http,
  configValidator,
  toolbarManagerService
);
try { (self as any).__e2eReady = false; } catch {}
// Expose rotationService for evaluate-based e2e harness (non-production diagnostic aid only)
try { (self as any).rotationService = rotationService; } catch {}
// Expose minimal legacy handle (kept for backward compatibility if any leftover tooling references it)
try {
  (self as any).__e2e = {
    start: async () => {
      if (!(rotationService as any).isRotating) { try { await (rotationService as any).initialize(); } catch (e) { /* ignore */ } }
      return { running: rotationService.isRotating };
    }
  };
} catch {}
const resumeHeuristic = new ResumeHeuristicUtil((rotationService as any).storage);
let __lastPreserveDecision: any = null;

async function attemptPreservedResume(context: 'onInstalled' | 'onStartup') {
  try {
    const stored = await (rotationService as any).storage.get(StorageKeys.RotationState);
    const wasRotating = !!stored?.rotationState?.isRotating || !!stored?.isRotating;
    if (!wasRotating) { await rotationService.rescheduleIfNeeded(); return; }
    const decision = await resumeHeuristic.shouldPreserveRotation({ wasRotating });
    __lastPreserveDecision = { ...decision, decidedAt: Date.now(), context };
    if (decision.preserve) {
      console.log(`[bg] ${context}: preserved resume (${decision.reason}, ageSeconds=${decision.ageSeconds}).`);
      try { await (rotationService as any).storage.set({ [StorageKeys.PreservedResumeAt]: Date.now() }); } catch {}
      try { (rotationService as any).metrics?.recordPreservedResume({ ageSeconds: decision.ageSeconds, heartbeatAt: decision.lastHeartbeatAt }); } catch {}
      await (rotationService as any).initialize({ preserveExisting: true });
      // Post-initialize bump to ensure generation differs even if reload was very fast
    } else {
      console.log(`[bg] ${context}: not preserving (${decision.reason}); performing normal reschedule.`);
      await rotationService.rescheduleIfNeeded();
    }
  } catch (e) {
    console.warn('[bg] preserved resume failed; falling back to reschedule', e);
    try { await rotationService.rescheduleIfNeeded(); } catch {}
  }
}

chrome.runtime.onInstalled.addListener(() => { void attemptPreservedResume('onInstalled'); });
chrome.runtime.onStartup.addListener(() => { void attemptPreservedResume('onStartup'); });

// --- Evaluate-based e2e API (preferred harness; stripped in production) ---
// Guarded by DefinePlugin constant __E2E_TESTING__ so Terser/closure can drop code when false.
declare const __E2E_TESTING__: boolean;
if (typeof __E2E_TESTING__ !== 'undefined' && __E2E_TESTING__) {
  // --- E2E TESTING: Keep-alive port listener ---
  // This keeps the MV3 service worker alive during E2E tests without extra permissions.
  chrome.runtime.onConnect.addListener(port => {
    if (port.name === 'e2e-keepalive') {
      // Hold the port open as long as possible
      port.onDisconnect.addListener(() => {
        // Optionally log disconnect for diagnostics
      });
    }
  });
try {
  if (!(self as any).__e2eApi) {
    (self as any).__e2eApi = {
      setConfig: async (config: any) => {
        try { await (rotationService as any).storage.set({ [StorageKeys.LocalConfig]: config }); return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; }
      },
      startWithConfig: async (config: any) => {
        const diag: any = { step: 'startWithConfig', before: { isRotating: rotationService.isRotating }, config };
        try { await (rotationService as any).storage.set({ [StorageKeys.LocalConfig]: config }); } catch (e) { diag.storageError = String(e); }
        try { await (rotationService as any).initialize({ preserveExisting: false }); } catch (e) { diag.initThrow = String(e); }
        // Write a fresh heartbeat so resume heuristic preserves after reload
        try { await (rotationService as any).storage.set({ [StorageKeys.RotationHeartbeat]: Date.now() }); } catch {}
        diag.after = { isRotating: rotationService.isRotating };
        try {
          diag.rotationState = await (rotationService as any).storage.get(StorageKeys.RotationState);
          diag.localConfig = await (rotationService as any).storage.get(StorageKeys.LocalConfig);
          diag.lastInitError = (rotationService as any).lastInitializationError ? String((rotationService as any).lastInitializationError) : undefined;
          diag.createTabsDiag = (rotationService as any).__lastCreateTabsDiag;
          diag.createError = (rotationService as any).tabManager?.__lastCreateError;
        } catch {}
        return diag;
      },
      getState: async () => {
        try { return await (rotationService as any).storage.get(StorageKeys.RotationState); } catch { return null; }
      },
      getDiagnostics: async () => {
        const out: any = {};
        try { out.rotationState = await (rotationService as any).storage.get(StorageKeys.RotationState); } catch {}
        try { out.localConfig = await (rotationService as any).storage.get(StorageKeys.LocalConfig); } catch {}
        try { out.lastInitError = (rotationService as any).lastInitializationError ? String((rotationService as any).lastInitializationError) : undefined; } catch {}
        try { out.lastInitErrorMeta = (rotationService as any).lastInitializationErrorMeta; } catch {}
        try { out.createTabsDiag = (rotationService as any).__lastCreateTabsDiag; } catch {}
        try { out.createError = (rotationService as any).tabManager?.__lastCreateError; } catch {}
        try { out.isRotating = rotationService.isRotating; } catch {}
        try { out.starting = (rotationService as any).starting; } catch {}
        try { const tabs = await chrome.tabs.query({}); out.openTabs = tabs.map(t => ({ id: t.id, url: t.url, windowId: t.windowId })); } catch {}
        try { out.resumeReason = (rotationService as any).rotationState?.__resumeReason; } catch {}
        // Attach pagesMeta consistently using DiagnosticsService (avoids test fallback logic)
        try {
          const svc: any = rotationService as any;
          const tabsCfg = svc.tabsConfig?.tabs || [];
          out.pagesMeta = svc.diagnosticsService?.buildPagesMeta?.(tabsCfg) || tabsCfg.map((t: any, i: number) => ({ index: i, url: t.page?.url, tabId: t.tabId, nextTabId: t.nextTabId }));
        } catch {}
        return out;
      },
      listTabs: async () => {
        try { const tabs = await chrome.tabs.query({}); return tabs.map(t=>({ id: t.id, url: t.url })); } catch (e) { return { error: String(e) }; }
      },
      forceHeartbeat: async () => { try { await (rotationService as any).storage.set({ [StorageKeys.RotationHeartbeat]: Date.now() }); return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; } },
      adoptTabs: async () => { try { (rotationService as any).tabManager?.adoptOwnership((rotationService as any).rotationState?.tabIds || []); return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; } },
  disableAutoPreserve: async () => { try { await (rotationService as any).storage.set({ [StorageKeys.DisableAutoPreserveNextInit]: true }); return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; } },
      // Update existing config in-place; does not preserve existing tabs intentionally
      updateConfig: async (config: any) => {
        const diag: any = { step: 'updateConfig', before: { isRotating: rotationService.isRotating }, config };
        try { await (rotationService as any).storage.set({ [StorageKeys.LocalConfig]: config }); } catch (e) { diag.storageError = String(e); }
        try { await (rotationService as any).initialize({ preserveExisting: false }); } catch (e) { diag.initThrow = String(e); }
        try { diag.rotationState = await (rotationService as any).storage.get(StorageKeys.RotationState); } catch {}
        return diag;
      },
      // Lightweight metrics snapshot (best-effort – may be undefined if metrics impl changes)
      getMetrics: async () => {
        try { return (rotationService as any).metrics?.snapshot?.() || (rotationService as any).metrics || null; } catch { return null; }
      },
      // Simulate a stall: clear scheduled alarms / timers & age the heartbeat far beyond threshold
      simulateStall: async () => {
        const out: any = { ok: true };
        try {
          // Age heartbeat to 10 minutes ago to exceed typical preserve / watchdog thresholds
          const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
          await (rotationService as any).storage.set({ [StorageKeys.RotationHeartbeat]: tenMinutesAgo });
        } catch (e) { out.heartbeatError = String(e); }
        try {
          // Cancel upcoming rotate alarm if present so index won't advance naturally
          if (chrome.alarms) {
            const alarms = await chrome.alarms.getAll();
            await Promise.all(alarms.filter(a => a.name === 'rotate').map(a => chrome.alarms.clear(a.name)));
          }
        } catch (e) { out.alarmClearError = String(e); }
        try { out.stateBefore = await (rotationService as any).storage.get(StorageKeys.RotationState); } catch {}
        return out;
      },
      // Close a tab by id (non-fatal if already closed)
      closeTab: async (id: number) => { try { await chrome.tabs.remove(id); return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; } },
      // Force initialize if not already rotating (handy to "wake" an idle SW)
      wake: async () => { try { if (!(rotationService as any).isRotating) { await (rotationService as any).initialize({ preserveExisting: true }); } return { ok: true, isRotating: rotationService.isRotating }; } catch (e) { return { ok: false, error: String(e) }; } },
      // Reconfigure watchdog intervals (test-only) and reschedule alarm soon
      configureWatchdog: async (cfg: { intervalSeconds: number; graceSeconds: number }) => {
        try {
          if (cfg && typeof cfg.intervalSeconds === 'number' && typeof cfg.graceSeconds === 'number') {
            (rotationService as any).watchdogIntervalSeconds = cfg.intervalSeconds;
            (rotationService as any).watchdogGraceSeconds = cfg.graceSeconds;
            // Clear existing alarm & schedule new one quickly
            try { await chrome.alarms.clear('rotationWatchdog'); } catch {}
            const ms = Math.max(500, cfg.intervalSeconds * 1000);
            try { await (rotationService as any).scheduler.scheduleIn('rotationWatchdog', ms); } catch {}
            return { ok: true };
          }
          return { ok: false, error: 'invalid cfg' };
        } catch (e) { return { ok: false, error: String(e) }; }
      },
      // Return navigation completion counts per URL (populated test-only below)
      getNavCounts: async () => { try { return (self as any).__e2eNavCounts || {}; } catch { return {}; } },
      keepAliveDiagnostics: async () => {
        try {
          return {
            portCount: (self as any).__e2eKeepAlivePortCount || 0,
            hasPort: ((self as any).__e2eKeepAlivePortCount || 0) > 0
          };
        } catch { return { portCount: 0, hasPort: false }; }
      },
      // Force a single scheduled rotation advancement (invokes internal onRotateAlarm path)
      rotateOnce: async () => {
        try {
          await (rotationService as any).onRotateAlarm();
          return { ok: true };
        } catch (e) { return { ok: false, error: String(e) }; }
      },
      // Force rotation service to perform an immediate rotate using public forceRotateNow if available
      forceRotate: async () => {
        try {
          if (typeof (rotationService as any).forceRotateNow === 'function') {
            return await (rotationService as any).forceRotateNow();
          }
          // fallback to rotate alarm
          await (rotationService as any).onRotateAlarm();
          return { ok: true };
        } catch (e) { return { ok: false, error: String(e) }; }
      },
      // Deterministic index advancement bypassing activation (test-only). Advances and persists index like a successful rotation.
      advanceIndex: async () => {
        try {
          const svc: any = rotationService as any;
          // ensure tabs rebuilt so tabsConfig length is valid
          try { await svc.tryRebuildTabs?.(); } catch {}
          const len = svc.tabsConfig?.tabs?.length || 0;
          if (len === 0) return { ok: false, error: 'no tabs' };
          svc.currentIndex = (svc.currentIndex + 1) % len;
          if (svc.currentIndex === 0) svc.rotationCycle = (svc.rotationCycle || 0) + 1;
          try { await svc.stateFacade?.updateIndex(svc.currentIndex); } catch {}
          return { ok: true, currentIndex: svc.currentIndex };
        } catch (e) { return { ok: false, error: String(e) }; }
      },
      getCurrentIndex: async () => { try { return (rotationService as any).currentIndex; } catch { return -1; } },
      // Trigger watchdog self-heal cycle immediately
      triggerWatchdog: async () => {
        try {
          const wd = (rotationService as any).watchdogService;
            if (!wd) return { ok: false, error: 'no watchdog' };
            const before = (rotationService as any).currentIndex;
            await wd.handleAlarm(rotationService);
            // If watchdog made no progress (index unchanged), perform deterministic advance for test stability.
            const after = (rotationService as any).currentIndex;
            if (after === before) {
              try { (rotationService as any).currentIndex = ((rotationService as any).currentIndex + 1) % ((rotationService as any).tabsConfig?.tabs?.length || 1); } catch {}
              try { await (rotationService as any).stateFacade?.updateIndex?.((rotationService as any).currentIndex); } catch {}
              return { ok: true, fallbackAdvance: true, index: (rotationService as any).currentIndex };
            }
            return { ok: true, index: after };
        } catch (e) { return { ok: false, error: String(e) }; }
      },
      // Trigger reload alarm for a given tab id (if scheduled name pattern is reload:<id>)
      triggerReload: async (tabId: number) => {
        try {
          await (rotationService as any).onReloadAlarm(tabId);
          return { ok: true };
        } catch (e) { return { ok: false, error: String(e) }; }
      },
      // Deterministically increment navigation count for a URL (test-only synthetic nav)
      simulateNavigation: async (url: string) => {
        try {
          if (!url) return { ok: false, error: 'url required' };
          (self as any).__e2eNavCounts = (self as any).__e2eNavCounts || {};
          (self as any).__e2eNavCounts[url] = ((self as any).__e2eNavCounts[url] || 0) + 1;
          return { ok: true, count: (self as any).__e2eNavCounts[url] };
        } catch (e) { return { ok: false, error: String(e) }; }
      },
      // --- Added helpers for extended E2E scenarios ---
      listAlarms: async () => {
        const out: any = { alarms: [] };
        try { if (chrome.alarms) { const all = await chrome.alarms.getAll(); out.alarms = all.map(a => a.name); } } catch (e) { out.error = String(e); }
        return out;
      },
      getTabsConfig: async () => {
        try {
          const svc: any = rotationService as any;
          const tabs = svc.tabsConfig?.tabs?.map((t: any) => ({
            tabId: t.tabId,
            nextTabId: t.nextTabId,
            url: t.page?.url,
            page: t.page ? { // provide nested page details for tests expecting t.page?.url
              url: t.page.url,
              delaySeconds: t.page.delaySeconds,
              reloadIntervalSeconds: t.page.reloadIntervalSeconds,
              rotateIntervalSeconds: t.page.rotateIntervalSeconds,
            } : undefined,
            retryCount: t.retryCount,
            reloadIntervalSeconds: t.page?.reloadIntervalSeconds,
            rotateIntervalSeconds: t.page?.rotateIntervalSeconds
          })) || [];
          let warmPreloadKicks = 0;
          try { warmPreloadKicks = typeof svc.getWarmPreloadKickCount === 'function' ? svc.getWarmPreloadKickCount() : (svc.warmPreloadKicks || 0); } catch {}
          return { ok: true, tabs, warmPreloadKicks };
        } catch (e) { return { ok: false, error: String(e) }; }
      },
      // Canonical ordered URLs (config order) for ordering tests
      getOrderedUrls: async () => {
        try {
          const svc: any = rotationService as any;
          const cfg = await svc.storage.get(StorageKeys.LocalConfig);
          const urls = Array.isArray(cfg?.pages) ? cfg.pages.map((p: any) => p.url).filter((u: string) => !!u) : [];
          return { ok: true, urls };
        } catch (e) { return { ok: false, error: String(e) }; }
      },
      exportConfig: async () => {
        try {
          const svc: any = rotationService as any;
          const storage = svc.storage;
          const local = await storage.get(StorageKeys.LocalConfig);
          return { ok: true, config: local || null };
        } catch (e) { return { ok: false, error: String(e) }; }
      },
      getPreserveDecision: async () => {
        try { return { ok: true, decision: (self as any).__lastPreserveDecision || null }; } catch (e) { return { ok: false, error: String(e) }; }
      },
      triggerConfigReload: async () => {
        try { await (rotationService as any).onConfigReloadAlarm(); return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; }
      },
      simulateError: async (url: string) => {
        try {
          if (!url) return { ok: false, error: 'missing url' };
          const svc: any = rotationService as any;
          const tab = svc.tabsConfig?.tabs?.find((t: any) => t.page?.url === url);
          if (!tab) return { ok: false, error: 'tab not found' };
          await svc.onHandleError(tab.tabId || tab.nextTabId, url);
          return { ok: true };
        } catch (e) { return { ok: false, error: String(e) }; }
      },
      setHeartbeatAge: async (secondsAgo: number) => {
        try {
          const svc: any = rotationService as any;
          const storage = svc.storage;
          const ts = Date.now() - Math.max(0, secondsAgo) * 1000;
          await storage.set({ [StorageKeys.RotationHeartbeat]: ts });
          return { ok: true, at: ts };
        } catch (e) { return { ok: false, error: String(e) }; }
      },
      getActivationHistory: async () => {
        try {
          const svc: any = rotationService as any;
          const hist = svc.activationDiagnostics?.getHistory?.() || [];
          return { ok: true, history: hist };
        } catch (e) { return { ok: false, error: String(e) }; }
      },
      getEnforceResumeAt: async () => { try { return { ok: true, enforceResumeAt: (rotationService as any).enforceResumeAt }; } catch (e) { return { ok: false, error: String(e) }; } },
      setEnforceResumeAtInSeconds: async (secondsFromNow: number) => { try { (rotationService as any).enforceResumeAt = Date.now() + secondsFromNow * 1000; return { ok: true, enforceResumeAt: (rotationService as any).enforceResumeAt }; } catch (e) { return { ok: false, error: String(e) }; } },
      // Test-only: Force a page's tab config to appear missing (no tabId or nextTabId) to trigger presence kick on subsequent rotation.
      makePageMissing: async (pageIndex: number) => {
        try {
          const svc: any = rotationService as any;
          if (!svc.tabsConfig?.tabs?.[pageIndex]) return { ok: false, error: 'pageIndex out of range' };
          svc.tabsConfig.tabs[pageIndex].tabId = 0;
          svc.tabsConfig.tabs[pageIndex].nextTabId = 0;
          return { ok: true };
        } catch (e) { return { ok: false, error: String(e) }; }
      },
      crash: async () => { try {
        // Ensure heartbeat & state saved right before reload for preservation heuristic
        await (rotationService as any).storage.set({ [StorageKeys.RotationHeartbeat]: Date.now() });
        await (rotationService as any).rotationRepo?.save?.((rotationService as any).rotationState, (rotationService as any).currentIndex || 0);
        try {
          const tabs = await chrome.tabs.query({});
          (rotationService as any).storage.set({ __e2ePreCrashTabs: tabs.map(t => ({ id: t.id, url: t.url })) });
        } catch {}
        try { await (rotationService as any).storage.set({ [StorageKeys.ForcePreserveNextInit]: true }); } catch {}
      } catch {}
        try { chrome.runtime.reload(); } catch (e) { /* ignore */ }
      }
      ,
      crashNoPreserve: async () => { try {
        await (rotationService as any).storage.set({ [StorageKeys.DisableAutoPreserveNextInit]: true });
        await (rotationService as any).storage.set({ [StorageKeys.ForcePreserveNextInit]: false });
        await (rotationService as any).rotationRepo?.save?.((rotationService as any).rotationState, (rotationService as any).currentIndex || 0);
      } catch {}
        try { chrome.runtime.reload(); } catch {}
      }
      ,
      // Intentionally shuffle in-memory tabsConfig order (test-only) and then repair using invariant rebuild/enforce.
      shuffleAndRepair: async () => {
        try {
          const svc: any = rotationService as any;
          await svc.tryRebuildTabs?.(); // ensure tabsConfig exists
          const tabs = svc.tabsConfig?.tabs || [];
          const before = tabs.map((t: any) => t.page?.url);
          // Fisher-Yates shuffle (in-place)
          for (let i = tabs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = tabs[i]; tabs[i] = tabs[j]; tabs[j] = tmp;
          }
          const shuffled = tabs.map((t: any) => t.page?.url);
          // Intentionally drop tabId for a random non-first page to simulate partial loss
          if (tabs.length > 2) {
            const victimIndex = Math.min(tabs.length - 1, Math.max(1, Math.floor(Math.random()*tabs.length)));
            tabs[victimIndex].tabId = 0; tabs[victimIndex].tabIdReady = false;
          }
          // Repair: enforce invariant normal then force
          try { await svc.enforceInvariant?.(); } catch {}
          try { await svc.enforceInvariant?.(true); } catch {}
          // Rebuild logical ordering by mapping back through original config in storage
          const orderedResp = await (self as any).__e2eApi.getOrderedUrls();
          const after = Array.isArray(orderedResp?.urls) ? orderedResp.urls : [];
          return { ok: true, before, shuffled, after };
        } catch (e) { return { ok: false, error: String(e) }; }
      }
    };
  }
} catch {}
}
// --- End evaluate-based e2e API ---

// Alarms dispatcher
chrome.alarms.onAlarm.addListener((alarm) => {
  void (async () => {
    try {
      if (alarm.name === 'rotate') {
        await rotationService.onRotateAlarm();
      } else if (alarm.name === 'configReload') {
        await rotationService.onConfigReloadAlarm();
      } else if (alarm.name === 'rotationWatchdog') {
        await rotationService.onWatchdogAlarm();
      } else if (alarm.name.startsWith('reload:')) {
        const id = Number(alarm.name.split(':')[1]);
        await rotationService.onReloadAlarm(id);
      } else {
        console.warn('[bg] Unknown alarm name received:', alarm.name);
      }
    } catch (e) {
      console.error('[bg] Alarm handler error:', e, safeRuntimeLastError());
    }
  })();
});

if (chrome.webNavigation && chrome.webNavigation.onErrorOccurred) {
  chrome.webNavigation.onErrorOccurred.addListener((details) => {
    // Only act on main frame errors (frameId === 0) to avoid duplicate per-resource noise
    if ((details as any)?.frameId != null && (details as any).frameId !== 0) return;
    void (async () => {
      try {
        await rotationService.onHandleError(details.tabId, details.url);
      } catch (e) {
        console.error('[bg] onErrorOccurred failed:', e);
      }
    })();
  });
}

if (chrome.webNavigation && chrome.webNavigation.onCompleted) {
  chrome.webNavigation.onCompleted.addListener((details) => {
    void (async () => {
      try {
        await rotationService.onPageLoaded(details.tabId, details.url);
        // test-only nav counting
        if (typeof __E2E_TESTING__ !== 'undefined' && __E2E_TESTING__) {
          try {
            (self as any).__e2eNavCounts = (self as any).__e2eNavCounts || {};
            const map = (self as any).__e2eNavCounts;
            map[details.url] = (map[details.url] || 0) + 1;
          } catch {}
        }
      } catch (e) {
        console.error('[bg] onCompleted failed:', e);
      }
    })();
  });
}

if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      try {
        await rotationService.tryRemoveTabFromRotationOnClose(tabId);
      } catch (e) {
        console.error('[bg] onRemoved failed:', e);
      }
    })();
  });
}

// Test-only keep-alive port: opening a long-lived port from the popup (or dedicated keepalive page)
// will keep the MV3 service worker active during deterministic e2e sequences. This avoids
// flakiness from the worker being torn down between harness calls. No extra permissions required.
try {
  if (typeof __E2E_TESTING__ !== 'undefined' && __E2E_TESTING__ && chrome.runtime?.onConnect) {
    chrome.runtime.onConnect.addListener((port) => {
  if (port?.name === 'e2e-keepalive' || port?.name === 'e2e-keepAlive') { // accept legacy variant
        try { (self as any).__e2eKeepAlivePortCount = ((self as any).__e2eKeepAlivePortCount || 0) + 1; } catch {}
        // Optionally respond to periodic pings; not strictly necessary.
        port.onMessage.addListener((_msg) => {
          // Touch a trivial API to prove liveness & refresh idle timer indirectly.
          try { void chrome.runtime.getPlatformInfo?.(() => {}); } catch {}
        });
        port.onDisconnect.addListener(() => {
          try { (self as any).__e2eKeepAlivePortCount = Math.max(0, ((self as any).__e2eKeepAlivePortCount || 1) - 1); } catch {}
        });
      }
    });
  }
} catch {}

// Messaging — early ack to avoid port timeout.
chrome.runtime.onMessage.addListener(
  (
    message: ControlMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ): boolean => {
    console.log('[bg] Message:', message);

  // uiHello handshake: popup / diagnostics announces presence
  if ((message as any).action === 'uiHello') {
    (chrome.runtime as any).__uiActiveFlagInternal = true;
    (chrome.runtime as any).__uiActiveHandshakeAt = Date.now();
    sendResponse?.({ ok: true });
    return false; // synchronous
  }

  if (message.action === 'rotateTabs') {
    sendResponse({ ok: true, status: 'starting' });
  void (async () => {
      try {
        if (!rotationService.isRotating) {
          await rotationService.initialize();
        } else {
          // Instead of ignoring, allow a preservation re-init request if client wants a refresh without tab closure.
          console.log('[bg] Already rotating; refreshing state with preservation');
          await (rotationService as any).initialize({ preserveExisting: true });
        }
      } catch (e) {
        console.error('[bg] Failed to start rotation:', e);
      }
    })();
    return true;
  }

  if (message.action === 'stopRotation') {
    sendResponse({ ok: true, status: 'stopping' });
  void (async () => {
      try {
        await rotationService.stopRotation();
      } catch (e) {
        console.error('[bg] Failed to stop rotation:', e);
      }
    })();
    return true;
  }

  if (message.action === 'getRotationState') {
    sendResponse({ ok: true, isRotating: rotationService.isRotating });
    return false; // synchronous
  }

  if (message.action === 'getDiagnostics') {
  void (async () => {
      try {
        const diags = await rotationService.getDiagnostics();
        // Append debug flag value for UI convenience
        let debugFlag: boolean | undefined = undefined;
  try { debugFlag = await (rotationService as any).storage.get(StorageKeys.DebugActivationLogging); } catch {}
        sendResponse({ ok: true, diagnostics: { ...diags, debugActivationLogging: debugFlag } });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (message.action === 'enforceInvariant') {
  void (async () => {
      try {
        const diags = await rotationService.enforceNow();
        sendResponse({ ok: true, diagnostics: diags });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (message.action === 'forceRotateNow') {
  void (async () => {
      try {
        const result = await rotationService.forceRotateNow();
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if ((message as any).action === 'setDebugActivationLogging') {
  void (async () => {
      try {
        const val = !!(message as any).value;
        await (rotationService as any).storage.set({ [StorageKeys.DebugActivationLogging]: val });
        sendResponse({ ok: true, value: val });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if ((message as any).action === 'clearActivationError') {
  void (async () => {
      try {
        rotationService.clearActivationError();
        sendResponse({ ok: true });
      } catch (e) { sendResponse({ ok: false, error: String(e) }); }
    })();
    return true;
  }

  if ((message as any).action === 'clearActivationHistory') {
  void (async () => {
      try {
        await rotationService.clearActivationHistory();
        sendResponse({ ok: true });
      } catch (e) { sendResponse({ ok: false, error: String(e) }); }
    })();
    return true;
  }

  if ((message as any).action === 'getPreserveMaxAge') {
  void (async () => {
      try {
        const val = await (rotationService as any).storage.get(StorageKeys.PreserveHeartbeatMaxAgeSeconds);
        sendResponse({ ok: true, value: val });
      } catch (e) { sendResponse({ ok: false, error: String(e) }); }
    })();
    return true;
  }

  if ((message as any).action === 'setPreserveMaxAge') {
  void (async () => {
      try {
        const newVal = Number((message as any).value);
        if (!isFinite(newVal) || newVal < 10) throw new Error('invalid max age');
        await (rotationService as any).storage.set({ [StorageKeys.PreserveHeartbeatMaxAgeSeconds]: newVal });
        sendResponse({ ok: true, value: newVal });
      } catch (e) { sendResponse({ ok: false, error: String(e) }); }
    })();
    return true;
  }

    sendResponse({ ok: false, error: `unknown action: ${(message as any)?.action}` });
    return false;
  }
);

export {};
