/** Shared console silencer to suppress expected noisy warnings/errors during tests. */
export function installConsoleSilencer() {
  if ((globalThis as any).__consoleSilencerInstalled) return;
  (globalThis as any).__consoleSilencerInstalled = true;
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  const noisyPatterns = [
    /RotationStateRepository\.save failed/i,
    /Failed to set toolbar icon/i,
    /storage\] set failed/i,
    /storage\] get failed/i,
  ];
  (console as any).error = (...args: any[]) => {
    const msg = args.join(' ');
    if (noisyPatterns.some(p => p.test(msg))) return; // swallow expected noise
    originalError(...args);
  };
  (console as any).warn = (...args: any[]) => {
    const msg = args.join(' ');
    if (noisyPatterns.some(p => p.test(msg))) return;
    originalWarn(...args);
  };
}
