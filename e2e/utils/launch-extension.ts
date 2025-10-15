import { chromium, BrowserContext, BrowserContextOptions, Worker } from '@playwright/test';
import path from 'path';
import fs from 'fs';

export interface LaunchedExtension {
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker; // Playwright Worker representing extension service worker
}

async function waitForServiceWorker(context: BrowserContext, timeoutMs = 60000): Promise<Worker> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const workers = context.serviceWorkers();
    const sw = workers.find((w: Worker) => /background/i.test(w.url()));
    if (sw) return sw;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Service worker not found for extension within timeout');
}

export async function launchExtension(distRelative = 'dist/chrome-tabs-rotator', extraOptions: BrowserContextOptions = {}): Promise<LaunchedExtension> {
  const extensionPath = path.join(process.cwd(), distRelative);
  if (!fs.existsSync(extensionPath)) {
    throw new Error(`Extension dist not found at ${extensionPath}. Build it first (yarn e2e:build).`);
  }
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ],
    ...extraOptions
  });
  // Heuristic: attempt to derive extensionId early by scanning extensions directory listing if possible (fallback to later parse)
  // We open the popup proactively to wake the MV3 service worker.
  // We don't yet know the ID until SW appears; create a temporary page to enumerate extensions may be overkill.
  // Instead, after loading extension, open any chrome://extensions-internals is not allowed; we will poll the eventual SW. To accelerate: open all potential popups by brute force attempt when ID known.
  let serviceWorker: Worker | undefined;
  let extensionId: string | undefined;
  // Attempt to derive extension ID heuristically: background.js exists inside dist root; Chrome assigns ephemeral ID
  // We wait for SW but also try to trigger activation by opening index.html using a guessed ID list (not possible pre-ID),
  // so fallback is still polling. If first wait iteration fails, attempt a forced wake by briefly creating a tab to index.html
  try {
    serviceWorker = await waitForServiceWorker(context);
    const match = serviceWorker.url().match(/chrome-extension:\/\/([a-p]{32})/);
    if (match) extensionId = match[1];
  } catch (e) {
    // Fallback: brute force open potential pages from existing workers (none) – just continue; will retry below.
  }
  if (!serviceWorker) {
    // Force wake attempt: open all pages in the dist folder that could cause activation (index.html)
    try {
      const tmpPage = await context.newPage();
      // We don't know ID yet; opening index is impossible without ID, so this is a no-op placeholder.
      await tmpPage.close();
    } catch {}
    // Retry wait once more
    try {
      serviceWorker = await waitForServiceWorker(context, 15000);
      const match = serviceWorker.url().match(/chrome-extension:\/\/([a-p]{32})/);
      if (match) extensionId = match[1];
    } catch {}
  }
  if (!serviceWorker || !extensionId) {
    throw new Error('Failed to obtain extension service worker / ID after retries');
  }
  // Open popup (wake) and a lightweight keep-alive page that holds a long-lived port connection
  try {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/index.html`);
    // Inject a keep-alive connector (idempotent) – relies on test-only background listener
    await popup.addInitScript(() => {
      try {
        // Only open one port
        if (!(window as any).__e2eKeepAlivePort) {
          // Cast to any for MV3 runtime.connect with options object (Playwright context doesn't supply chrome types fully)
          const port = (chrome.runtime as any).connect({ name: 'e2e-keepalive' });
          (window as any).__e2eKeepAlivePort = port;
          // Periodic ping every 5s to exercise runtime API (defensive; SW idle timer ~30s)
          setInterval(() => { try { port.postMessage({ t: Date.now() }); } catch {} }, 5000);
        }
      } catch {}
    });
    // Brief settle
    await new Promise(r=>setTimeout(r,400));
  } catch {}
  return { context, extensionId, serviceWorker };
}

export async function simulateServiceWorkerRestart(context: BrowserContext): Promise<Worker> {
  const workers = context.serviceWorkers();
  const sw = workers[0];
  if (!sw) throw new Error('No service worker to restart');
  // Simulated restart: we can't reliably detect MV3 runtime.reload in Playwright here, so re-run initialize with preserve flag.
  await sw.evaluate(async () => {
    try {
      const rs = (self as any).rotationService;
      if (!rs) return;
      // Determine disable flag to choose preservation behavior
      let disable = false;
      try { disable = !!(await rs.storage.get('disableAutoPreserveNextInit')); } catch {}
      if (disable) {
        await rs.initialize({ preserveExisting: false });
      } else {
        await rs.initialize({ preserveExisting: true });
      }
      try { (self as any).__e2eGeneration = Date.now(); } catch {}
    } catch {}
  });
  return sw;
}
// Backward compatibility: deprecated name
