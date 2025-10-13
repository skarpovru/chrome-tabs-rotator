import { StorageKeys } from '../app/models';
import { StorageService } from './storage.service';

export interface PreserveDecision {
  preserve: boolean;
  reason: string;
  lastHeartbeatAt?: number;
  ageSeconds?: number;
}

export class ResumeHeuristicUtil {
  constructor(private storage: StorageService = new StorageService()) {}

  /**
   * Decide whether to preserve existing rotation tabs.
   * - Requires stored rotation state isRotating true.
   * - Uses last heartbeat; if missing or older than maxAgeSeconds -> do not preserve (likely stale session).
   * - If heartbeat recent (<= maxAgeSeconds) -> preserve.
   */
  async shouldPreserveRotation(params: { wasRotating: boolean; maxAgeSeconds?: number }): Promise<PreserveDecision> {
    const { wasRotating } = params;
    const maxAge = params.maxAgeSeconds ?? 300; // 5 minutes default
    if (!wasRotating) return { preserve: false, reason: 'not-rotating' };
    let lastHeartbeatAt: number | undefined;
    try { lastHeartbeatAt = await this.storage.get<number>(StorageKeys.RotationHeartbeat); } catch {}
    if (!lastHeartbeatAt) return { preserve: false, reason: 'no-heartbeat' };
    const ageSeconds = Math.round((Date.now() - lastHeartbeatAt) / 1000);
    if (ageSeconds <= maxAge) {
      return { preserve: true, reason: 'recent-heartbeat', lastHeartbeatAt, ageSeconds };
    }
    return { preserve: false, reason: 'heartbeat-stale', lastHeartbeatAt, ageSeconds };
  }
}
