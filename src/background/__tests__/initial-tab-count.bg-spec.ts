import { createRotationServiceHarness } from './test-helpers/rotation-service-harness';
import { RotationService } from '../rotation.service';
import { TabConfig } from '../../app/models';

/**
 * Ensures initial rotation start creates exactly one tab per configured page (no preloads yet).
 */
describe('initial tab count without preloads', () => {
  it('matches pages length on initial start (no preloads yet)', async () => {
    const pages = [
      { url: 'https://count.example/a', delaySeconds: 2 },
      { url: 'https://count.example/b', delaySeconds: 3 },
      { url: 'https://count.example/c', delaySeconds: 4 }
    ];
  const { service } = createRotationServiceHarness({ config: { pages } });
    await service.initialize();
    const tabs = (service as any).tabsConfig?.tabs as TabConfig[];
    expect(tabs.length).toBe(pages.length);
    // Each tab should have only a primary ID (nextTabId stays 0 initially)
    for (const t of tabs) {
      expect(t.tabId > 0).toBeTrue();
      expect(t.nextTabId).toBe(0);
    }
  });
});
