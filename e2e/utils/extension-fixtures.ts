import { test as base } from '@playwright/test';
import { launchExtension, LaunchedExtension } from './launch-extension';

export const test = base.extend<{ ext: LaunchedExtension }>({
  ext: async ({}, use) => {
    let lastErr: any;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const launched = await launchExtension();
        try {
          await use(launched);
        } finally {
          try { await launched.context.close(); } catch {}
        }
        return;
      } catch (e) {
        lastErr = e;
        await new Promise(r => setTimeout(r, 400 * attempt));
      }
    }
    throw lastErr || new Error('Failed to launch extension after retries');
  }
});

// Attempt to ensure a clean slate before each test by stopping any active rotation
// no-op beforeEach now; fresh context each test
test.beforeEach(async () => {});

export const expect = test.expect;
