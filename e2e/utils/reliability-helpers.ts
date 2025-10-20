import { BrowserContext, Worker } from '@playwright/test';
import { callE2E as callApi } from './call-e2e-api';

/**
 * Wait until the MV3 service worker exposes the __e2eApi test surface.
 */
export async function waitForWorkerApi(context: BrowserContext, timeoutMs = 6000): Promise<Worker> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const w = context.serviceWorkers().at(-1);
    if (w) {
      try {
        const ready = await w.evaluate(() => !!(self as any).__e2eApi);
        if (ready) return w;
      } catch {/* ignore transient eval errors */}
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('E2E API not ready');
}

/**
 * Wait until rotation currentIndex matches expected. Returns last observed even on timeout.
 */
export async function waitForIndex(context: BrowserContext, expected: number, maxWaitMs = 5000): Promise<number> {
  const deadline = Date.now() + maxWaitMs;
  let last = -1;
  while (Date.now() < deadline) {
    try {
      last = await callApi(context, 'getCurrentIndex');
      if (last === expected) return last;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  return last; // return last observed even if mismatch for assertion
}

/**
 * Poll alarms list.
 */
export async function pollAlarms(context: BrowserContext): Promise<string[]> {
  try {
    const res = await callApi(context, 'listAlarms');
    return res.alarms || [];
  } catch { return []; }
}

/**
 * Wait until rotation cycle reaches (or surpasses) target.
 */
export async function waitForRotationCycle(context: BrowserContext, cycleTarget: number, maxWaitMs = 8000): Promise<number> {
  const deadline = Date.now() + maxWaitMs;
  let observed = -1;
  while (Date.now() < deadline) {
    try {
      const diags = await callApi(context, 'getDiagnostics');
      observed = diags.rotation?.rotationCycle ?? -1;
      if (observed >= cycleTarget) return observed;
    } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  return observed;
}

/**
 * Wait for tabIds length to reach at least minCount. Throws on timeout.
 */
export async function waitForTabIds(context: BrowserContext, minCount: number, timeoutMs = 6000): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const diags = await callApi(context, 'getDiagnostics');
      const ids = diags?.rotationState?.tabIds;
      if (Array.isArray(ids) && ids.length >= minCount) return ids.slice();
    } catch {/* ignore */}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('Timeout waiting for tabIds >= ' + minCount);
}

/**
 * Waits until the page entry for the given URL has a stable primary tab (tabIdReady true),
 * with retryCount still 0 (no prior error-triggered retries), avoiding error throttling suppression
 * in onHandleError. Returns the tab config snapshot or throws on timeout.
 */
export async function awaitStableTab(context: BrowserContext, url: string, timeoutMs = 6000, opts: { allowRetry?: boolean } = {}): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let lastCfg: any = null;
  while (Date.now() < deadline) {
    try {
      const tc = await callApi(context, 'getTabsConfig');
      const entry = tc?.tabs?.find((t: any) => t.url === url);
      if (entry) {
        lastCfg = entry;
        // Primary readiness: prefer explicit tabIdReady flag; fallback to ready.primary if present
        const primaryReady = entry.tabId > 0 && (entry.tabIdReady === true || entry.ready?.primary === true);
        // When allowRetry is true, accept retryCount>0 so long as page not suspended
        const noPreErrorReq = opts.allowRetry ? !entry.suspended : ((entry.retryCount || 0) === 0);
        if (primaryReady && noPreErrorReq) return entry;
      }
    } catch {/* ignore transient */}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Timeout awaiting stable tab for ' + url + ' last=' + JSON.stringify(lastCfg));
}
