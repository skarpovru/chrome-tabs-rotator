// <reference types="jasmine" />
import { ActivationDiagnosticsService } from '../activation-diagnostics.service';
import { StorageService } from '../storage.service';

describe('ActivationDiagnosticsService ring buffer', () => {
  let svc: ActivationDiagnosticsService;
  beforeEach(async () => {
    (globalThis as any).chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
    svc = new ActivationDiagnosticsService(new StorageService());
    await svc.init();
  });

  it('records success/failure and maintains lastSuccessAt', async () => {
    await svc.record({ success: false, stage: 'activate', tabId: 1, pageIndex: 0 });
    expect(svc.getLastSuccessAt()).toBeNull();
    await svc.record({ success: true, stage: 'activate', tabId: 2, pageIndex: 1 });
    const last = svc.getLastSuccessAt();
    expect(last).not.toBeNull();
    const history = svc.getHistory();
    expect(history.length).toBe(2);
    expect(history[0].success).toBeFalse();
    expect(history[1].success).toBeTrue();
  });

  it('trims history to max size (50)', async () => {
    for (let i=0;i<60;i++) {
      await svc.record({ success: i%2===0, stage: 'cycle', tabId: i, pageIndex: 0 });
    }
    const h = svc.getHistory();
    expect(h.length).toBeLessThanOrEqual(50);
    // Should contain the most recent entries (i from 10..59)
    expect(h[0].tabId).toBeGreaterThan(9);
  });
});
