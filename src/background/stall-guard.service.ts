/**
 * StallGuardService
 * -----------------
 * Encapsulates heuristics for detecting and recording stall events.
 */
export interface StallState {
  stallCount: number;
  lastStallAt: number | null;
  lastStallReason: string | null;
}

export class StallGuardService {
  state: StallState = { stallCount: 0, lastStallAt: null, lastStallReason: null };

  record(reason: string) {
    this.state.stallCount++;
    this.state.lastStallAt = Date.now();
    this.state.lastStallReason = reason;
  }

  /**
   * Evaluate post-rotation conditions to detect a stall (e.g., stuck on last page).
   * Returns true if a corrective action (index reset) is recommended.
   */
  evaluateRotation(params: {
    activatedIndex: number | null;
    tabCount: number;
    lastRotationAt: number | null;
    delaySeconds: number;
    lastActivatedPageIndex: number | null;
  }): boolean {
    const { activatedIndex, tabCount, lastRotationAt, delaySeconds, lastActivatedPageIndex } = params;
    if (tabCount > 1 && activatedIndex === tabCount - 1) {
      const expectedSwitchDue = lastRotationAt ? lastRotationAt + delaySeconds * 1000 : 0;
      if (lastActivatedPageIndex === tabCount - 1 && Date.now() > expectedSwitchDue + 5000) {
        this.record('stuck-on-last-page');
        return true;
      }
    }
    return false;
  }

  /**
   * Evaluate watchdog tick to detect stalled transition after last page.
   * Returns true if watchdog should force a rotate.
   */
  evaluateWatchdog(params: {
    tabCount: number;
    lastActivatedPageIndex: number | null;
    currentIndex: number;
    lastRotationAt: number | null;
    firstPageDelaySeconds: number;
  }): boolean {
    const { tabCount, lastActivatedPageIndex, currentIndex, lastRotationAt, firstPageDelaySeconds } = params;
    if (tabCount > 1 && lastActivatedPageIndex === tabCount - 1 && currentIndex === 0) {
      if (lastRotationAt && Date.now() > lastRotationAt + firstPageDelaySeconds * 1000 + 5000) {
        this.record('watchdog-stuck-last-page');
        return true;
      }
    }
    return false;
  }
}
