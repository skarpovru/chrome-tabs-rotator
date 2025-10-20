import { createRotationServiceHarness } from './test-helpers/rotation-service-harness';
import { RotationService } from '../rotation.service';
import { TabConfig } from '../../app/models';

/**
 * Verifies the post-rotation warmPreloads presence kick only fires after at least
 * one full cycle (rotationCycle>=1) AND when there exists at least one page lacking
 * both tabId and nextTabId. We simulate by crafting a tabsConfig with a missing page
 * after a completed cycle, then invoking rotateTabs via onRotateAlarm path.
 */

describe('rotation warmPreloads presence kick', () => {
  it('only increments warmPreloadKicks after >=1 cycle with persistent missing pages', async () => {
    const svc: RotationService = createRotationServiceHarness({ config: { pages: [ { url: 'https://a.example', delaySeconds: 1 }, { url: 'https://b.example', delaySeconds: 1 }, { url: 'https://c.example', delaySeconds: 1 } ] } }).service;
    // Ensure required chrome alarms APIs exist (some prior tests may have installed a simpler mock)
    (globalThis as any).chrome.alarms.getAll = (globalThis as any).chrome.alarms.getAll || (async () => []);
    (globalThis as any).chrome.alarms.get = (globalThis as any).chrome.alarms.get || (async () => undefined);
    await svc.initialize();
    const tabs = (svc as any).tabsConfig?.tabs as TabConfig[];
    expect(tabs.length).toBe(3);
    await (svc as any).warmPreloads();
  // Force activation success so rotateTabs reaches presence kick path.
  (svc as any).activationService.activateTabWithFallback = async () => true;

    const wipe = (t: TabConfig) => { t.tabId = 0; t.tabIdReady = false; t.nextTabId = 0; t.nextTabIdReady = false; };
    wipe(tabs[1]); wipe(tabs[2]);
    const preKick0 = (svc as any).warmPreloadKicks || 0;
    (svc as any).presenceKickIfNeeded();
    expect(((svc as any).warmPreloadKicks || 0)).toBe(preKick0);
    (svc as any).rotationCycle = 1;
    wipe(tabs[1]); wipe(tabs[2]);
    const preKick1 = (svc as any).warmPreloadKicks || 0;
    (svc as any).presenceKickIfNeeded();
    expect(((svc as any).warmPreloadKicks || 0)).toBeGreaterThan(preKick1);
  });
});
