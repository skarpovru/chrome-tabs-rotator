import { BrowserContext, Worker } from '@playwright/test';

export async function getLatestWorker(context: BrowserContext): Promise<Worker | undefined> {
  const workers = context.serviceWorkers();
  // Choose the most recently added (last in list)
  return workers[workers.length - 1];
}

export async function callE2E<T = any>(context: BrowserContext, fn: string, arg?: any, retries = 4): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const worker = await getLatestWorker(context);
      if (!worker) throw new Error('No service worker available');
      const result = await worker.evaluate(([f, a]) => {
        const api = (self as any).__e2eApi;
        if (!api) throw new Error('__e2eApi not ready');
        if (typeof (api as any)[f] !== 'function') throw new Error(`__e2eApi.${f} not a function`);
        return (api as any)[f](a);
      }, [fn, arg]);
      return result as T;
    } catch (e: any) {
      lastErr = e;
      // Retry on transient worker loss
      await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastErr;
}
