import { expect } from '@playwright/test';
import { test } from '../utils/extension-fixtures';
import { callE2E } from '../utils/call-e2e-api';
import { waitForWorkerApi, waitForTabIds } from '../utils/reliability-helpers';
import { STABLE_DOMAIN_PRIMARY } from '../utils/stable-domains';

/**
 * Shuffle + Repair Ordering Test
 * ------------------------------
 * Validates that artificial in-memory ordering corruption (tabsConfig array shuffle + dropped tabId) is repaired
 * without changing the canonical config ordering of page URLs.
 */
test.describe('Ordering shuffle & repair', () => {
  test('canonical order restored after shuffleAndRepair cycles', async ({ ext }) => {
    const { context } = ext;
    await waitForWorkerApi(context);
    const config = {
      pages: [
  { url: STABLE_DOMAIN_PRIMARY + '/shuffle-alpha', delaySeconds: 1 },
  { url: STABLE_DOMAIN_PRIMARY + '/shuffle-bravo', delaySeconds: 1 },
  { url: STABLE_DOMAIN_PRIMARY + '/shuffle-charlie', delaySeconds: 1 },
  { url: STABLE_DOMAIN_PRIMARY + '/shuffle-delta', delaySeconds: 1 },
  { url: STABLE_DOMAIN_PRIMARY + '/shuffle-echo', delaySeconds: 1 },
  { url: STABLE_DOMAIN_PRIMARY + '/shuffle-foxtrot', delaySeconds: 1 }
      ],
      isFullscreen: false,
      preventWindowFocus: false
    } as any;

    await callE2E(context, 'startWithConfig', config);
  await waitForTabIds(context, config.pages.length, 8000, { injectSyntheticSuccess: true });

    const initialOrderResp: any = await callE2E(context, 'getOrderedUrls');
    expect(initialOrderResp.ok).toBeTruthy();
    const canonical = initialOrderResp.urls;
    expect(canonical).toEqual(config.pages.map((p: any) => p.url));

    // Perform multiple shuffle/repair passes
    for (let i = 0; i < 5; i++) {
      const res: any = await callE2E(context, 'shuffleAndRepair');
      expect(res.ok).toBeTruthy();
      expect(res.after).toEqual(canonical);
    }

    // Final verification: ordering unchanged
    const finalOrderResp: any = await callE2E(context, 'getOrderedUrls');
    expect(finalOrderResp.urls).toEqual(canonical);

    await context.close();
  });
});
