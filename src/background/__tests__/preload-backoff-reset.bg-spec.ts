import { createRotationServiceHarness, installChromeWithStorage } from './test-helpers/rotation-service-harness';
import { TabConfig } from '../../app/models';

/**
 * Integration-style test for backoff reset: simulate one failed preload alarm (discard + backoff)
 * then a successful promotion clearing backoff fields.
 */
describe('preload backoff reset after successful promotion', () => {
  it('resets backoff fields on successful promotion', async () => {
    // Ensure a clean chrome mock not polluted by previous specs that force creation failures.
    (globalThis as any).chrome = undefined;
    installChromeWithStorage({
      tabs: {
        create: async (opts: any) => ({ id: Math.floor(Math.random() * 1000) + 400, windowId: 1, active: !!opts.active, url: opts.url }),
        get: async (id: number) => ({ id, windowId: 1 }),
        update: async (id: number, _opts: any) => ({ id, windowId: 1 }),
        onUpdated: { addListener: () => {}, removeListener: () => {} }
      }
    });
    const pages = [ { url: 'https://backoff-reset.example', delaySeconds: 1, reloadIntervalSeconds: 2 } ];
    const { service } = createRotationServiceHarness({ config: { pages } });
    await service.initialize();
    // Wait until tab manager has created initial primary tab
    let cfg: TabConfig | undefined;
    for (let i = 0; i < 40; i++) { // up to ~1s
      cfg = (service as any).tabManager?.tabsConfig?.tabs?.[0];
      if (cfg && cfg.tabId > 0) break;
      await new Promise(r => setTimeout(r, 25));
    }
    cfg = cfg || (service as any).tabManager?.tabsConfig?.tabs?.[0];
    expect(cfg).toBeTruthy();
    const originalPrimary = cfg!.tabId;
    // --- Failed preload attempt ---
    // Manually create a preload but DO NOT mark it ready; then fire reload alarm on that preload to cause discard.
    const tm = (service as any).tabManager;
    await tm.createTab(cfg, async ()=>{}); // with existing primary this assigns nextTabId
  const firstPreloadId = cfg!.nextTabId;
    expect(firstPreloadId).toBeGreaterThan(0);
    // Fire reload alarm targeting preload (not ready) -> discard + backoff
    await (service as any).onReloadAlarm(firstPreloadId);
  expect(cfg!.nextTabId).toBe(0);
  expect((cfg!.preloadFailureCount ?? 0)).toBeGreaterThanOrEqual(1);
  expect((cfg!.currentPreloadBackoffMs ?? 0)).toBeGreaterThan(0);
  expect((cfg!.nextPreloadAllowedAt ?? 0)).toBeGreaterThan(Date.now());
  const recordedBackoff = cfg!.currentPreloadBackoffMs;
    // Expire backoff window so next attempt is allowed
  cfg!.nextPreloadAllowedAt = Date.now() - 1;

    // --- Successful promotion attempt ---
    await tm.createTab(cfg, async ()=>{}); // create second preload
  const secondPreloadId = cfg!.nextTabId;
    expect(secondPreloadId).toBeGreaterThan(0);
  cfg!.nextTabIdReady = true; // simulate load complete
    await (service as any).onReloadAlarm(secondPreloadId);

    // Assertions: promotion and reset
  expect(cfg!.tabId).toBe(secondPreloadId);
  expect(cfg!.tabId).not.toBe(originalPrimary);
  expect(cfg!.nextTabId).toBe(0);
  expect(cfg!.preloadFailureCount).toBe(0);
  expect((cfg!.currentPreloadBackoffMs || 0)).toBe(0);
  expect(cfg!.nextPreloadAllowedAt).toBeUndefined();
    // Ensure previous backoff was non-zero to validate transition
    expect(recordedBackoff).toBeGreaterThan(0);
  });
});
