// Global console error guard to surface unexpected errors as spec failures.
// Runs early (prefixed with 'a-').
describe('global console guard', () => {
  const whitelist = [
    /RotationStateRepository\.save failed/i,
    /storage\] (get|getMany|set|remove) failed/i,
    /Failed to set toolbar icon/i,
    /Failed to initialize rotation:/i,
    /createTab chrome\.tabs\.create failed/i,
    /Failed to create placeholder tab at index/i
  ];
  let originalError: (...args:any[])=>void;
  beforeAll(() => {
    originalError = console.error.bind(console);
    (console as any).error = (...args: any[]) => {
      const msg = args.map(a => (typeof a === 'string' ? a : (a && a.message) || '')).join(' ');
      if (whitelist.some(r => r.test(msg))) return originalError(...args); // still log whitelisted
      // Fail fast for unexpected messages
      fail('Unexpected console.error: ' + msg);
      originalError(...args);
    };
  });
  it('installed console error guard', () => {
    expect(true).toBeTrue();
  });
});
