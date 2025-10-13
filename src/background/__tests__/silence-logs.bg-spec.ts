// Installs shared console silencer prior to other specs.
import { installConsoleSilencer } from './test-helpers/console-silencer';

describe('log silencer', () => {
  it('installs console filters (idempotent)', () => {
    installConsoleSilencer();
    installConsoleSilencer(); // second call should no-op
    expect((globalThis as any).__consoleSilencerInstalled).toBeTrue();
  });
});
