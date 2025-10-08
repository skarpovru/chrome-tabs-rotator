import { installBaseChromeMocks } from './test-helpers/chrome-mock';
import { HealthMonitorService } from '../health-monitor.service';
import { ActivationDiagnosticsService } from '../activation-diagnostics.service';
import { CountdownService } from '../countdown.service';

// Minimal fake storage to satisfy ActivationDiagnosticsService dependency
class FakeStorage {
  async get() { return undefined; }
  async set() { /* noop */ }
}

describe('Badge color composition pipeline', () => {
  it('uses compositeColorProvider override when provided', async () => {
    const { } = installBaseChromeMocks();
    const activationDiagnostics = new ActivationDiagnosticsService(new FakeStorage() as any);
    await activationDiagnostics.init();

    const countdown = new CountdownService(activationDiagnostics);
    const actionSetBg: any[] = [];
    (globalThis as any).chrome.action.setBadgeBackgroundColor = (arg: any) => { actionSetBg.push(arg.color); };
    (globalThis as any).chrome.action.setBadgeText = () => {};

    const override = jestLikeFn(() => '#123456');

    const when = Date.now() + 2500; // ~2.5s
    countdown.start({ when, compositeColorProvider: override });

    // Let a couple of ticks run
    await delay(1100);
    expect(override.calls.length).toBeGreaterThan(0);
    expect(actionSetBg.some((c: string) => c === '#123456')).toBeTrue();

    countdown.stop();
  });

  it('falls back to diagnostics + health monitor colors when no override', async () => {
    installBaseChromeMocks();
    const activationDiagnostics = new ActivationDiagnosticsService(new FakeStorage() as any);
    await activationDiagnostics.init();
    const countdown = new CountdownService(activationDiagnostics);

    // Force diagnostics to appear stale (simulate long time since success) so it returns warning or error color
    (activationDiagnostics as any).lastSuccessAt = Date.now() - 10 * 60 * 1000; // 10 min
    const actionSetBg: any[] = [];
    (globalThis as any).chrome.action.setBadgeBackgroundColor = (arg: any) => { actionSetBg.push(arg.color); };
    (globalThis as any).chrome.action.setBadgeText = () => {};

    const when = Date.now() + 1500;
    countdown.start({ when });
    await delay(1100);

    // Expect at least one of the standard palette colors (green/warn/error) produced by diagnostics fallback
    const palette = ['#15803d','#ca8a04','#dc2626','#b91c1c','#9b1c1c'];
    expect(actionSetBg.some(c => palette.includes(c))).toBeTrue();
    countdown.stop();
  });
});

function delay(ms: number) { return new Promise(res => setTimeout(res, ms)); }
function jestLikeFn<T extends (...a:any)=>any>(fn: T) { const wrapper: any = (...a:any[]) => { wrapper.calls.push(a); return fn(...a); }; wrapper.calls = []; return wrapper; }
