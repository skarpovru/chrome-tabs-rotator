import { createRotationServiceHarness } from './test-helpers/rotation-service-harness';
import { RotationService } from '../rotation.service';
import { TabConfig } from '../../app/models';

/**
 * Verifies successful preload after a reload alarm promotes the new tab and removes the old primary.
 */
describe('preload success after reload alarm', () => {
  it('promotes preload and removes old primary on success', async () => {
    const pages = [ { url: 'https://preload-success.example', delaySeconds: 1, reloadIntervalSeconds: 1 } ];
  const { service, waitForPromotion } = createRotationServiceHarness({ config: { pages } });
    await service.initialize();
    const tabs = (service as any).tabsConfig?.tabs as TabConfig[];
    expect(tabs.length).toBe(1);
    const cfg = tabs[0];
    const originalPrimary = cfg.tabId;
  // Manually create a preload (simulate background scheduling before alarm)
  const tabManager = (service as any).tabManager;
  await tabManager.createTab(cfg, async (id:number)=>{ /* track noop */ });
  // After createTab with existing primary, nextTabId should be set.
  const preloadId = cfg.nextTabId;
  expect(preloadId).toBeGreaterThan(0);
  // Simulate load completion
  cfg.nextTabIdReady = true;
  // Trigger reload alarm targeting the preload to promote it.
  await (service as any).onReloadAlarm(preloadId);
  expect(cfg.tabId).not.toBe(originalPrimary);
  expect(cfg.nextTabId).toBe(0);
    // After alarm logic with successful load, primary should have changed (promoted)
    const promotedPrimary = cfg.tabId;
    expect(promotedPrimary).not.toBe(originalPrimary);
    expect(cfg.nextTabId).toBe(0); // preload consumed
  });
});
