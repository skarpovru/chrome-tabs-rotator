// Basic chrome API shim to avoid ReferenceErrors before individual specs install richer mocks.
if (typeof globalThis.chrome === 'undefined') {
  globalThis.chrome = { tabs: {}, alarms: {}, runtime: {}, windows: {} };
}
