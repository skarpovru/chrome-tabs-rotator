// E2E utility helpers for polling chrome.storage in extension pages.
// Declaring chrome for TS in test context.
// Usage: await pollRemoteConfig(page, cfg => cfg?.pages?.length === 2)

import { Page } from '@playwright/test';

declare const chrome: any;

export async function getStorageValue<T = any>(page: Page, key: string): Promise<T | undefined> {
  return await page.evaluate((k) => {
    return new Promise<any>((resolve) => {
      try { chrome.storage.local.get([k], (r: any) => resolve(r[k])); } catch { resolve(undefined); }
    });
  }, key);
}

export async function pollStorage<T = any>(page: Page, key: string, predicate: (v: T | undefined) => boolean, timeoutMs = 10000, intervalMs = 250): Promise<T | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const val = await getStorageValue<T>(page, key);
    if (predicate(val)) return val;
    await page.waitForTimeout(intervalMs);
  }
  return undefined;
}

export async function pollRemoteConfig(page: Page, predicate: (cfg: any | undefined) => boolean, timeoutMs = 10000): Promise<any | undefined> {
  return pollStorage(page, 'remoteConfig', predicate, timeoutMs);
}

export async function pollLocalConfig(page: Page, predicate: (cfg: any | undefined) => boolean, timeoutMs = 10000): Promise<any | undefined> {
  return pollStorage(page, 'localConfig', predicate, timeoutMs);
}
