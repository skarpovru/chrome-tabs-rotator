export interface RotationTimingInfo {
  lastRotationAt: number | null;
  nextRotationDueAt: number | null;
}

export interface StallInfo {
  stallCount: number;
  lastStallAt: number | null;
  lastStallReason: string | null;
}

export interface HealthSnapshot extends RotationTimingInfo, StallInfo {
  severity: 'ok' | 'warn' | 'error';
}

export class HealthMonitorService {
  private timing: RotationTimingInfo = { lastRotationAt: null, nextRotationDueAt: null };
  private stall: StallInfo = { stallCount: 0, lastStallAt: null, lastStallReason: null };
  private activationMetricsProvider?: () => { lastSuccessAt: number | null; recentHistory: { success: boolean; at: number }[] };

  attachActivationMetrics(provider: () => { lastSuccessAt: number | null; recentHistory: { success: boolean; at: number }[] }) {
    this.activationMetricsProvider = provider;
  }

  recordScheduled(nextAt: number) {
    this.timing.nextRotationDueAt = nextAt;
  }

  recordRotationComplete() {
    this.timing.lastRotationAt = Date.now();
  }

  clearSchedule() { this.timing.nextRotationDueAt = null; }

  recordStall(reason: string) {
    this.stall.stallCount++;
    this.stall.lastStallAt = Date.now();
    this.stall.lastStallReason = reason;
  }

  adoptStallState(state: { stallCount?: number; lastStallAt?: number | null; lastStallReason?: string | null }) {
    if (typeof state.stallCount === 'number') this.stall.stallCount = state.stallCount;
    if (state.lastStallAt !== undefined) this.stall.lastStallAt = state.lastStallAt;
    if (state.lastStallReason !== undefined) this.stall.lastStallReason = state.lastStallReason;
  }

  snapshot(): HealthSnapshot {
    const { lastRotationAt, nextRotationDueAt } = this.timing;
    const { stallCount, lastStallAt, lastStallReason } = this.stall;
    // Enhanced severity heuristic
    let severity: HealthSnapshot['severity'] = 'ok';
    const now = Date.now();
    const overdue = nextRotationDueAt && now > nextRotationDueAt + 15000; // 15s grace overdue
    if (stallCount > 0 || overdue) severity = 'warn';
    if (stallCount > 3 || (overdue && stallCount > 1)) severity = 'error';
    if (this.activationMetricsProvider) {
      const act = this.activationMetricsProvider();
      if (act) {
        const { lastSuccessAt, recentHistory } = act;
        const recentFailures = recentHistory.filter(r => !r.success && now - r.at < 120000).length; // 2m window
        if (!lastSuccessAt) severity = 'error';
        else if (recentFailures >= 5) severity = 'error';
        else if (recentFailures >= 2 && severity === 'ok') severity = 'warn';
      }
    }
    return { lastRotationAt, nextRotationDueAt, stallCount, lastStallAt, lastStallReason, severity };
  }

  computeCompositeBadgeColor(fallbackGreen: string = '#15803d'): string {
    const snap = this.snapshot();
    if (snap.severity === 'ok') return fallbackGreen;
    if (snap.severity === 'warn') return '#ca8a04';
    return '#dc2626';
  }
}
