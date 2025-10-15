import { test, expect } from '@playwright/test';
import { launchExtension, simulateServiceWorkerRestart } from '../utils/launch-extension';
import { callE2E } from '../utils/call-e2e-api';

test.describe('Crash recovery (preserved resume)', () => {
  test('keeps tabs and resumes rotation after service worker restart', async () => {
    const { context, serviceWorker, extensionId } = await launchExtension();
  // Ensure at least one normal window/page exists (some environments may start with none).
  const page = await context.newPage();
  await page.goto('about:blank');

    // Poll for __e2eApi readiness; open popup if needed to wake SW.
    let apiReady = false;
    for (let i=0;i<10 && !apiReady;i++) {
  try { apiReady = !!await callE2E(context, 'getDiagnostics'); } catch { apiReady = false; }
      if (!apiReady) await new Promise(r=>setTimeout(r,200));
    }
    if (!apiReady) {
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/index.html`);
      for (let i=0;i<10 && !apiReady;i++) {
  try { apiReady = !!await callE2E(context, 'getDiagnostics'); } catch { apiReady = false; }
        if (!apiReady) await new Promise(r=>setTimeout(r,200));
      }
    }
    expect(apiReady).toBeTruthy();
    try {
      // Enable test mode & seed config
      const config = { pages: [
        { url: 'https://example.com', delaySeconds: 3, reloadIntervalSeconds: 0 },
        { url: 'https://example.org', delaySeconds: 3, reloadIntervalSeconds: 0 }
      ], isFullscreen: false, preventWindowFocus: false };
  const startDiag = await callE2E(context, 'startWithConfig', config as any);
      if (!startDiag?.after?.isRotating) console.log('startWithConfig diag', startDiag);
      // Poll until tabs created
      let rotationReady = !!startDiag?.after?.isRotating;
      let lastDiag: any = startDiag;
      for (let i=0;i<25 && !rotationReady;i++) {
        await new Promise(r=>setTimeout(r,400));
  lastDiag = await callE2E(context, 'getDiagnostics');
        const tabIds = lastDiag?.rotationState?.tabIds || lastDiag?.rotationState?.rotationState?.tabIds;
        if (Array.isArray(tabIds) && tabIds.length >= 2) { rotationReady = true; break; }
      }
      if (!rotationReady) console.log('final diagnostics after polling', lastDiag);
      expect(rotationReady).toBeTruthy();

      // Wait for tabs creation (poll storage state)
      let tabIds: number[] = [];
      for (let i=0;i<30;i++) {
  const diag = await callE2E(context, 'getDiagnostics');
        const ids = diag?.rotationState?.tabIds || diag?.rotationState?.rotationState?.tabIds;
        if (Array.isArray(ids) && ids.length >= 2) { tabIds = ids.slice(); break; }
        await new Promise(r => setTimeout(r, 400));
      }
      expect(tabIds.length).toBeGreaterThanOrEqual(2);

      // Force heartbeat just before crash to guarantee preservation heuristic sees a recent heartbeat
  await callE2E(context, 'forceHeartbeat');
  // Adopt tabs to ensure ownership is persisted
  await callE2E(context, 'adoptTabs');
  // Capture pre-crash snapshot
  const preCrash = await callE2E(context, 'getDiagnostics');

      // Restart SW (simulate crash)
  const newSw = await simulateServiceWorkerRestart(context);
      // Wait for __e2eApi in restarted worker
      for (let i=0;i<30;i++) {
        try { const d = await callE2E(context, 'getDiagnostics'); if (d) break; } catch {}
        await new Promise(r=>setTimeout(r,200));
      }
        // Verify preserved tabs still exist
        const preserved: any = await callE2E(context, 'listTabs');
        const existingIds = Array.isArray(preserved) ? new Set(preserved.map((t: any)=>t.id)) : new Set<number>();
        const missing = tabIds.filter(id => !existingIds.has(id));
        const preservedResult = { missing, all: Array.isArray(preserved) ? preserved : [] } as any;
        const postDiag = await callE2E(context, 'getDiagnostics');
  if (preservedResult?.missing?.length) {
          // Build a URL-based mapping to see if URLs are present but IDs changed
          const preTabs = preCrash.openTabs || [];
          const postTabs = postDiag.openTabs || [];
          const urlMap: Record<string, { preIds: number[]; postIds: number[] }> = {};
          for (const t of preTabs) {
            if (!t.url) continue; if (!urlMap[t.url]) urlMap[t.url] = { preIds: [], postIds: [] }; urlMap[t.url].preIds.push(t.id);
          }
          for (const t of postTabs) {
            if (!t.url) continue; if (!urlMap[t.url]) urlMap[t.url] = { preIds: [], postIds: [] }; urlMap[t.url].postIds.push(t.id);
          }
          console.log('After reload diagnostics (unexpected preservation failure)', {
            preserved: preservedResult,
            resumeReason: postDiag.resumeReason,
            expectedTabIds: tabIds,
            preCrashTabs: preTabs,
            postTabs,
            urlMap
          });
        }
  expect(preservedResult?.missing?.length).toBe(0);

      // Observe a rotation (active tab changes). Poll state index.
  const firstState: any = await callE2E(context, 'getState');
      const initialIndex = firstState?.currentIndex ?? firstState?.rotationState?.currentIndex ?? 0;
      let rotated = false;
      for (let i=0;i<20;i++) {
        await new Promise(r => setTimeout(r, 1000));
  const st: any = await callE2E(context, 'getState');
        const idx = st?.currentIndex ?? st?.rotationState?.currentIndex;
        if (typeof idx === 'number' && idx !== initialIndex) { rotated = true; break; }
      }
      expect(rotated).toBeTruthy();
    } finally {
      await context.close();
    }
  });
});
