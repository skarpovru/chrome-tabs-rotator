/**
 * MetricsService
 * --------------
 * Central lightweight in-memory metrics & event bus for streaming diagnostics.
 * Emits events via chrome.runtime.sendMessage so the diagnostics panel can subscribe
 * without polling heavy state.
 */
import { safeRuntimeSend } from '../shared';
export type MetricCounters = {
  rotations: number;
  stalls: number;
  focusAttempts: number;
  tabCreations: number;
  reloadsScheduled: number;
};

export type MetricsEventType =
  | 'rotation'
  | 'stall'
  | 'focus-attempt'
  | 'tab-created'
  | 'reload-scheduled'
  | 'preserved-resume'
  | 'diagnostics-tick';

export interface MetricsEvent<T = any> {
  type: MetricsEventType;
  at: number;
  data?: T;
  counters: MetricCounters;
}

export class MetricsService {
  private counters: MetricCounters = {
    rotations: 0,
    stalls: 0,
    focusAttempts: 0,
    tabCreations: 0,
    reloadsScheduled: 0,
  };

  private emit<T>(type: MetricsEventType, data?: T) {
    const event: MetricsEvent<T> = {
      type,
      at: Date.now(),
      data,
      counters: { ...this.counters },
    };
    try {
      const uiActive = (chrome.runtime as any).__uiActiveFlagInternal;
      if (!uiActive) return; // suppress emission if no UI has announced itself
    } catch {}
    safeRuntimeSend({ kind: 'metrics', event });
  }

  recordRotation(info?: any) {
    this.counters.rotations++; this.emit('rotation', info);
  }
  recordStall(reason: string) {
    this.counters.stalls++; this.emit('stall', { reason });
  }
  recordFocusAttempt(result: { success: boolean; source: string }) {
    this.counters.focusAttempts++; this.emit('focus-attempt', result);
  }
  recordTabCreation(pageUrl?: string) {
    this.counters.tabCreations++; this.emit('tab-created', { url: pageUrl });
  }
  recordReloadScheduled(tabId: number, seconds: number) {
    this.counters.reloadsScheduled++; this.emit('reload-scheduled', { tabId, seconds });
  }
  recordPreservedResume(info?: { ageSeconds?: number; heartbeatAt?: number }) {
    this.emit('preserved-resume', info);
  }

  snapshot() { return { counters: { ...this.counters } }; }
}
