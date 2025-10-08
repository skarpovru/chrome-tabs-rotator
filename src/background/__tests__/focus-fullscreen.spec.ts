// <reference types="jasmine" />
import { FocusOrchestratorService } from '../focus-orchestrator.service';
import { FocusService } from '../focus.service';
import { MetricsService } from '../metrics.service';
import { TabsConfig, TabConfig } from '../../app/models';
import { installBaseChromeMocks } from './test-helpers/chrome-mock';

describe('FocusOrchestratorService fullscreen attempt', () => {
  beforeEach(() => installBaseChromeMocks());

  it('enters fullscreen when config requests it and tab has windowId', async () => {
    (chrome as any).tabs.get = async () => ({ id: 101, windowId: 2 });
    let updated: any = [];
    (chrome as any).windows.update = async (id: number, info: any) => { updated.push({ id, info }); };
    const focus = new FocusService();
    const metrics = new MetricsService();
    const orchestrator = new FocusOrchestratorService(focus, metrics);
    const config: any = { isFullscreen: true, pages: [{ url: 'https://one' }] };
    const tabsConfig = new TabsConfig();
    tabsConfig.tabs.push(new TabConfig({ page: { url: 'https://one' } as any, active: true }));
    tabsConfig.tabs[0].tabId = 101;
    await orchestrator.tryFullscreen(config, tabsConfig, () => {});
    expect(updated.length).toBeGreaterThan(0);
  });

  it('skips fullscreen when config flag false', async () => {
    (chrome as any).tabs.get = async () => ({ id: 101, windowId: 2 });
    let updated: any = [];
    (chrome as any).windows.update = async (id: number, info: any) => { updated.push({ id, info }); };
    const focus = new FocusService();
    const metrics = new MetricsService();
    const orchestrator = new FocusOrchestratorService(focus, metrics);
    const config: any = { isFullscreen: false, pages: [{ url: 'https://one' }] };
    const tabsConfig = new TabsConfig();
    tabsConfig.tabs.push(new TabConfig({ page: { url: 'https://one' } as any, active: true }));
    tabsConfig.tabs[0].tabId = 101;
    await orchestrator.tryFullscreen(config, tabsConfig, () => {});
    expect(updated.length).toBe(0);
  });
});
