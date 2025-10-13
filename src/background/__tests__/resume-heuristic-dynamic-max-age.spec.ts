// <reference types="jasmine" />
import { ResumeHeuristicUtil } from '../resume-heuristic.util';
import { StorageKeys } from '../../app/models';
import { StorageService } from '../storage.service';

class MemoryStorage extends StorageService {
  private store: Record<string, any> = {};
  override async get(key: string): Promise<any> { return this.store[key]; }
  override async set(obj: Record<string, any>): Promise<void> { Object.assign(this.store, obj); }
}

describe('ResumeHeuristicUtil dynamic max age override', () => {
  it('uses stored PreserveHeartbeatMaxAgeSeconds when no explicit maxAgeSeconds passed', async () => {
    const ms = new MemoryStorage();
    // Heartbeat 5 minutes old (300s)
    const heartbeatAt = Date.now() - 300_000;
    await ms.set({ [StorageKeys.RotationHeartbeat]: heartbeatAt });
    // Store override of 400s so heartbeat is considered recent
    await ms.set({ [StorageKeys.PreserveHeartbeatMaxAgeSeconds]: 400 });

    const util = new ResumeHeuristicUtil(ms as any);
    const decision = await util.shouldPreserveRotation({ wasRotating: true });
  expect(decision.preserve).toBeTrue();
    expect(decision.reason).toBe('recent-heartbeat');
  });

  it('falls back to default when stored override is too small / invalid', async () => {
    const ms = new MemoryStorage();
    const heartbeatAt = Date.now() - 50_000; // 50s
    await ms.set({ [StorageKeys.RotationHeartbeat]: heartbeatAt });
    await ms.set({ [StorageKeys.PreserveHeartbeatMaxAgeSeconds]: 5 }); // too small, ignored (<10)

    const util = new ResumeHeuristicUtil(ms as any);
    // Without explicit maxAgeSeconds, should use default 300s which still treats 50s as recent
    const decision = await util.shouldPreserveRotation({ wasRotating: true });
    expect(decision.preserve).toBeTrue();
    expect(decision.reason).toBe('recent-heartbeat');
  });

  it('returns preserve=false when heartbeat older than stored override', async () => {
    const ms = new MemoryStorage();
    const heartbeatAt = Date.now() - 700_000; // ~11.6 min
    await ms.set({ [StorageKeys.RotationHeartbeat]: heartbeatAt });
    await ms.set({ [StorageKeys.PreserveHeartbeatMaxAgeSeconds]: 600 }); // 10 minutes

    const util = new ResumeHeuristicUtil(ms as any);
    const decision = await util.shouldPreserveRotation({ wasRotating: true });
  expect(decision.preserve).toBeFalse();
    expect(decision.reason).toBe('heartbeat-stale');
  });
});
