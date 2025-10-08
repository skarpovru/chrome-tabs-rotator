import { installBaseChromeMocks } from './test-helpers/chrome-mock';
import { ActivationService } from '../activation.service';

class FakeDiagnostics { history: any[]=[]; lastError: string|null=null; setLastError(e:any){this.lastError=e;} getLastError(){return this.lastError;} record(ev:any){this.history.push(ev);} }
class FakeFocusOrchestrator { async attemptTabFocus(){/* noop */} }

describe('ActivationService highlight fallback success', () => {
  it('succeeds via highlight when direct update leaves another tab active', async () => {
    installBaseChromeMocks();
    const diagnostics = new FakeDiagnostics();

    // update returns tab but active flag false (simulate Chrome not making it active quickly)
    (globalThis as any).chrome.tabs.update = async (id:number, _props:any) => ({ id, windowId: 1, active: false });
    // Sequence for highlight success inside first attempt:
    // 1) active query after update -> other tab (999)
    // 2) non-active window listing -> includes target (123) inactive so highlight path finds index
    // 3) active query after highlight -> target active
    let phase = 0;
    (globalThis as any).chrome.tabs.query = async (q:any) => {
      if (q.windowId === 1 && q.active) {
        if (phase === 0) { return [{ id: 999, active: true, windowId: 1 }]; }
        // After highlight
        return [{ id: 123, active: true, windowId: 1 }];
      }
      if (q.windowId === 1 && !q.active) {
        phase = 1; // window listing before highlight
        return [
          { id: 999, active: true, windowId: 1 },
          { id: 123, active: false, windowId: 1 }
        ];
      }
      return [];
    };
    (globalThis as any).chrome.tabs.highlight = async () => { phase = 2; };
    (globalThis as any).chrome.windows.getAll = async () => [{ id:1, tabs: [{ id: 999, active: true }] }];

    const svc = new ActivationService({
      diagnostics: diagnostics as any,
      focusOrchestrator: new FakeFocusOrchestrator() as any,
      debugFlagProvider: () => false,
      onActivated: () => {}
    });

    const ok = await svc.activateTabWithFallback(123, 0, 'rotateTabs');
    expect(ok).toBeTrue();
    const success = diagnostics.history.find(r => r.success);
    expect(success).toBeDefined();
    expect(success.stage).toContain('update-highlight');
  });
});
