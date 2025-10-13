import { ResumeHeuristicUtil } from '../resume-heuristic.util';
import { StorageKeys } from '../../app/models';
import { StorageService } from '../storage.service';

class MemoryStorage extends StorageService {
  private store: Record<string, any> = {};
  override async get(key: string): Promise<any> { return this.store[key]; }
  override async set(obj: Record<string, any>): Promise<void> { Object.assign(this.store, obj); }
}

describe('ResumeHeuristicUtil.shouldPreserveRotation', () => {
  it('returns preserve=false when not rotating', async () => {
    const util = new ResumeHeuristicUtil(new MemoryStorage() as any);
    const d = await util.shouldPreserveRotation({ wasRotating: false });
    expect(d.preserve).toBeFalse();
    expect(d.reason).toBe('not-rotating');
  });
  it('returns preserve=false when no heartbeat', async () => {
    const ms = new MemoryStorage();
    const util = new ResumeHeuristicUtil(ms as any);
    const d = await util.shouldPreserveRotation({ wasRotating: true });
    expect(d.preserve).toBeFalse();
    expect(d.reason).toBe('no-heartbeat');
  });
  it('returns preserve=true with recent heartbeat', async () => {
    const ms = new MemoryStorage();
    await ms.set({ [StorageKeys.RotationHeartbeat]: Date.now() - 10_000 });
    const util = new ResumeHeuristicUtil(ms as any);
    const d = await util.shouldPreserveRotation({ wasRotating: true, maxAgeSeconds: 60 });
    expect(d.preserve).toBeTrue();
    expect(d.reason).toBe('recent-heartbeat');
  });
  it('returns preserve=false with stale heartbeat', async () => {
    const ms = new MemoryStorage();
    await ms.set({ [StorageKeys.RotationHeartbeat]: Date.now() - 600_000 }); // 10 min
    const util = new ResumeHeuristicUtil(ms as any);
    const d = await util.shouldPreserveRotation({ wasRotating: true, maxAgeSeconds: 120 });
    expect(d.preserve).toBeFalse();
    expect(d.reason).toBe('heartbeat-stale');
  });
});
