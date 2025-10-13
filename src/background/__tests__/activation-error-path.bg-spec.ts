import { installBaseChromeMocks } from './test-helpers/chrome-mock';
import { ActivationService } from '../activation.service';

class FakeDiagnostics {
  history: any[] = []; lastError: string | null = null; lastSuccessAt: number | null = null;
  setLastError(e: string | null) { this.lastError = e; }
  getLastError() { return this.lastError; }
  record(ev: any) { this.history.push(ev); if (ev.success) this.lastSuccessAt = Date.now(); }
}
class FakeFocusOrchestrator { attempts: any[] = []; async attemptTabFocus(_src: any,_id: number, cb: () => void){ this.attempts.push(_id); cb(); } }

describe('ActivationService error fallback path', () => {
  it('records update + retry + final failure stages when activation never succeeds', async () => {
    installBaseChromeMocks();
    const diagnostics = new FakeDiagnostics();
    const focus = new FakeFocusOrchestrator();

    // Make chrome.tabs.update always throw
    (globalThis as any).chrome.tabs.update = async () => { throw new Error('update failed'); };
    // Query returns some other active tab so stage logic cannot succeed
    (globalThis as any).chrome.tabs.query = async () => [{ id: 999, active: true, windowId: 1 }];
    (globalThis as any).chrome.tabs.highlight = async () => {};
    (globalThis as any).chrome.windows.getAll = async () => [{ id:1, tabs: [{ id: 999, active: true }] }];

    const svc = new ActivationService({
      diagnostics: diagnostics as any,
      focusOrchestrator: focus as any,
      debugFlagProvider: () => false,
      onActivated: () => {}
    });

    const ok = await svc.activateTabWithFallback(123, 2, 'rotateTabs');
    expect(ok).toBeFalse();

    // Expect stages: update failed -> retry failed -> final record
    const stages = diagnostics.history.map(h => h.stage);
    expect(stages).toContain('update');
    expect(stages).toContain('retry');
    expect(stages).toContain('final');
    const failures = diagnostics.history.filter(h => !h.success);
    expect(failures.length).toBeGreaterThanOrEqual(3);
    expect(diagnostics.lastError).toBeTruthy();
  });

  it('succeeds on retry stage and records success', async () => {
    installBaseChromeMocks();
    const diagnostics = new FakeDiagnostics();
    const focus = new FakeFocusOrchestrator();

    let first = true;
    (globalThis as any).chrome.tabs.update = async (id: number) => {
      if (first) { first = false; throw new Error('update failed'); }
      return { id, windowId: 1, active: true };
    };
    (globalThis as any).chrome.tabs.query = async (_q: any) => [{ id: 555, active: true, windowId: 1 }];
    (globalThis as any).chrome.windows.getAll = async () => [{ id:1, tabs: [{ id: 555, active: true }] }];

    const svc = new ActivationService({
      diagnostics: diagnostics as any,
      focusOrchestrator: focus as any,
      debugFlagProvider: () => false,
      onActivated: () => {}
    });

    const ok = await svc.activateTabWithFallback(555, 0, 'rotateTabs');
    expect(ok).toBeTrue();
    const successRec = diagnostics.history.find(h => h.success);
    expect(successRec).toBeDefined();
    expect(successRec.stage === 'retry' || successRec.stage === 'retry-highlight').toBeTrue();
  });
});
