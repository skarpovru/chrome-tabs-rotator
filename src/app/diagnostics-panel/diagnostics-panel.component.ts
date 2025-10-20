import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, NgZone } from '@angular/core';
import { safeRuntimeLastError, safeRuntimeSend } from '../../shared';
import { CountdownStateService } from '../services/countdown-state.service';
import { OutboundMessage } from '../../shared/messages';

@Component({
    selector: 'app-diagnostics-panel',
    imports: [CommonModule],
    templateUrl: './diagnostics-panel.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class DiagnosticsPanelComponent {
  loading = false;
  error?: string;
  diags: any = null;
  autoRefresh = false;
  private timer?: any;
  metricsCounters: any = null; // live streaming counters
  private removeListener?: () => void;
  togglingDebug = false;
  expandedHistory = new Set<number>();
  preloadAggregations: any = null;
  preloadFilter: 'all' | 'failures' = 'all';

  private countdownSub?: any;
  countdownSeconds?: number;

  constructor(private cdr: ChangeDetectorRef, private zone: NgZone, private countdownState: CountdownStateService) {}

  ngOnInit() {
  void this.refresh();
  try { safeRuntimeSend({ action: 'uiHello' }); } catch {}
    this.countdownSub = this.countdownState.state$.subscribe(state => {
      if (state) {
        this.countdownSeconds = state.seconds;
        this.cdr.markForCheck();
      }
    });
    // Attach streaming listener once.
    const listener = (
      msg: OutboundMessage | any,
      sender: chrome.runtime.MessageSender,
      sendResponse: (resp?: any) => void
    ): boolean => {
      if (!msg || (msg as any).kind !== 'metrics' || !(msg as any).event) return false;
      // Run inside Angular zone for change detection.
      this.zone.run(() => {
        this.metricsCounters = (msg as any).event.counters;
        if (this.diags) {
          this.diags.metrics = { ...this.metricsCounters };
        }
        this.cdr.markForCheck();
      });
      // No async response expected
      return false;
    };
    try {
      chrome.runtime.onMessage.addListener(listener);
      this.removeListener = () => chrome.runtime.onMessage.removeListener(listener);
    } catch {}
  }

  ngOnDestroy() {
    this.stopAuto();
    if (this.removeListener) { try { this.removeListener(); } catch {} }
    try { this.countdownSub?.unsubscribe(); } catch {}
  }

  refresh() {
    this.loading = true;
    this.error = undefined;
  safeRuntimeSend({ action: 'getDiagnostics' }, undefined, (res: any) => {
    const lastErr = safeRuntimeLastError();
      if (lastErr) {
        this.error = lastErr || 'Message failed.';
        this.diags = null;
      } else if (!res || (res.ok === false && !res.diagnostics)) {
        this.error = (res && (res.error || res.status)) || 'Failed to load diagnostics.';
        this.diags = null;
      } else {
        this.diags = res?.diagnostics ?? res;
        this.computePreloadAggregations();
      }
      this.loading = false;
      this.cdr.detectChanges();
    });
  }

  fixExtras() {
    this.loading = true;
    this.error = undefined;
  safeRuntimeSend({ action: 'enforceInvariant' }, undefined, (res: any) => {
    const lastErr = safeRuntimeLastError();
      if (lastErr) {
        this.error = lastErr || 'Message failed.';
        this.diags = null;
      } else if (!res || (res.ok === false && !res.diagnostics)) {
        this.error = (res && (res.error || res.status)) || 'Failed to enforce invariant.';
      } else {
        this.diags = res?.diagnostics ?? res;
      }
      this.loading = false;
      this.cdr.detectChanges();
    });
  }

  copyJSON() {
    const data = JSON.stringify(this.diags, null, 2);
    navigator.clipboard.writeText(data).catch(() => {});
  }

  forceRotate() {
    this.loading = true;
    this.error = undefined;
  safeRuntimeSend({ action: 'forceRotateNow' }, undefined, (res: any) => {
    const lastErr = safeRuntimeLastError();
      if (lastErr) {
        this.error = lastErr || 'Message failed.';
      } else if (!res || res.ok === false) {
        this.error = (res && res.error) || 'Force rotate failed.';
      } else if (res.diagnostics) {
        this.diags = res.diagnostics;
        this.computePreloadAggregations();
      }
      this.loading = false;
      this.cdr.detectChanges();
    });
  }

  toggleAuto() {
    this.autoRefresh = !this.autoRefresh;
    if (this.autoRefresh) {
      this.timer = setInterval(() => this.refresh(), 3000);
    } else {
      this.stopAuto();
    }
    this.cdr.detectChanges();
  }

  private stopAuto() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  toggleDebugActivationLogging() {
    if (!this.diags) return;
    const nextVal = !this.diags.debugActivationLogging;
    this.togglingDebug = true;
    try {
  safeRuntimeSend({ action: 'setDebugActivationLogging', value: nextVal }, undefined, (res: any) => {
        const lastErr = safeRuntimeLastError();
        if (!lastErr && res?.ok) {
          this.diags.debugActivationLogging = res.value;
        } else if (lastErr) {
          this.error = 'Toggle failed: ' + lastErr;
        } else if (res && res.error) {
          this.error = 'Toggle failed: ' + res.error;
        }
        this.togglingDebug = false;
        this.cdr.detectChanges();
      });
    } catch (e) {
      this.error = 'Toggle failed: ' + e;
      this.togglingDebug = false;
    }
  }

  updatePreserveMaxAge(val: string) {
    const num = Number(val);
    if (!isFinite(num) || num < 10) return; // basic validation
    try {
  safeRuntimeSend({ action: 'setPreserveMaxAge', value: num }, undefined, (res: any) => {
        const lastErr = safeRuntimeLastError();
        if (lastErr) { this.error = 'Set max age failed: ' + lastErr; }
        else if (!res || res.ok === false) { this.error = 'Set max age failed: ' + (res?.error || 'unknown'); }
        else {
          if (this.diags?.rotation) this.diags.rotation.preserveMaxAgeSeconds = num;
        }
        this.cdr.detectChanges();
      });
    } catch {}
  }

  clearActivationError() {
    this.loading = true;
    try {
  safeRuntimeSend({ action: 'clearActivationError' }, undefined, (res: any) => {
        const lastErr = safeRuntimeLastError();
        if (!lastErr && res?.ok) {
          if (this.diags) this.diags.lastActivationError = null;
        } else if (lastErr) {
          this.error = 'Clear error failed: ' + lastErr;
        } else if (res && res.error) {
          this.error = 'Clear error failed: ' + res.error;
        }
        this.loading = false;
        this.cdr.detectChanges();
      });
    } catch (e) {
      this.error = 'Clear error failed: ' + e;
      this.loading = false;
    }
  }

  clearActivationHistory() {
    this.loading = true;
    try {
  safeRuntimeSend({ action: 'clearActivationHistory' }, undefined, (res: any) => {
        const lastErr = safeRuntimeLastError();
        if (!lastErr && res?.ok) {
          if (this.diags) this.diags.activationHistory = [];
        } else if (lastErr) {
          this.error = 'Clear history failed: ' + lastErr;
        } else if (res && res.error) {
          this.error = 'Clear history failed: ' + res.error;
        }
        this.loading = false;
        this.cdr.detectChanges();
      });
    } catch (e) {
      this.error = 'Clear history failed: ' + e;
      this.loading = false;
    }
  }

  exportPreloadHistory() {
    if (!this.diags?.preloadDiagnostics) return;
    try {
      const payload = this.diags.preloadDiagnostics.map((p: any) => ({
        index: p.index,
        url: p.url || p.pageUrl || this.diags?.pages?.[p.index]?.url,
        tabId: p.tabId,
        nextTabId: p.nextTabId,
        primaryInitialWaitMs: p.primaryInitialWaitMs,
        primaryInitialWaitOutcome: p.primaryInitialWaitOutcome,
        history: p.history || []
      }));
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), pages: payload }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'preload-history-' + Date.now() + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 2000);
    } catch (e) {
      this.error = 'Export failed: ' + e;
      this.cdr.markForCheck();
    }
  }

  toggleHistory(index: number) {
    if (this.expandedHistory.has(index)) this.expandedHistory.delete(index);
    else this.expandedHistory.add(index);
    this.cdr.markForCheck();
  }

  statusClass(status: string): string {
    switch (status) {
      case 'loading': return 'bg-yellow-100 text-yellow-800 border border-yellow-300 rounded px-1';
      case 'complete': return 'bg-green-100 text-green-800 border border-green-300 rounded px-1';
      case 'error': return 'bg-red-100 text-red-800 border border-red-300 rounded px-1';
      case 'timeout': return 'bg-orange-100 text-orange-800 border border-orange-300 rounded px-1';
      default: return 'bg-gray-100 text-gray-700 border border-gray-300 rounded px-1';
    }
  }

  outcomeClass(entry: any): string {
    const outcome = entry?.outcome || entry?.reason;
    if (!outcome) return 'bg-gray-200 text-gray-700 rounded px-1';
    if (outcome === 'promoted' || outcome === 'complete') return 'bg-green-200 text-green-900 rounded px-1';
    if (outcome === 'discarded') return 'bg-red-200 text-red-900 rounded px-1';
    if (outcome === 'timeout' || outcome === 'load-timeout') return 'bg-orange-200 text-orange-900 rounded px-1';
    if (outcome === 'error' || outcome === 'load-error') return 'bg-red-300 text-red-900 rounded px-1';
    return 'bg-yellow-100 text-yellow-800 rounded px-1';
  }

  private computePreloadAggregations() {
    const list = this.diags?.preloadDiagnostics || [];
    const agg: any = {
      pages: list.length,
      attempts: 0,
      promoted: 0,
      discarded: 0,
      timeout: 0,
      error: 0,
      avgWaitMs: 0,
      http2xx: 0,
      http4xx: 0,
      http5xx: 0,
      httpErrorEvents: 0,
      successRate: 0
    };
    let waitSum = 0; let waitCount = 0;
    for (const p of list) {
      const hist: any[] = p.history || [];
      agg.attempts += hist.length;
      let promotedCount = 0;
      for (const h of hist) {
        const outcome = h.outcome || h.reason;
        if (outcome === 'promoted' || outcome === 'complete') agg.promoted++;
        else if (outcome === 'discarded') agg.discarded++;
        else if (outcome === 'timeout' || outcome === 'load-timeout') agg.timeout++;
        else if (outcome === 'error' || outcome === 'load-error') agg.error++;
        if (typeof h.waitMs === 'number') { waitSum += h.waitMs; waitCount++; }
        const hs = h.httpStatus;
        if (typeof hs === 'number') {
          if (hs >= 200 && hs < 300) agg.http2xx++;
          else if (hs >= 400 && hs < 500) agg.http4xx++;
          else if (hs >= 500 && hs < 600) agg.http5xx++;
          else if (hs < 0) agg.httpErrorEvents++;
        }
        if (h.httpError) agg.httpErrorEvents++;
        if (outcome === 'promoted' || outcome === 'complete') promotedCount++;
      }
      const pageAttempts = hist.length || 1;
      (p as any).successRate = Math.round((promotedCount / pageAttempts) * 100);
    }
    agg.avgWaitMs = waitCount ? Math.round(waitSum / waitCount) : 0;
    const successDenom = Math.max(1, agg.attempts);
    agg.successRate = Math.round((agg.promoted / successDenom) * 100);
    this.preloadAggregations = agg;
  }

  setPreloadFilter(val: 'all' | 'failures') {
    this.preloadFilter = val;
    this.cdr.markForCheck();
  }

  filteredPreloads(): any[] {
    const list: any[] = this.diags?.preloadDiagnostics || [];
    if (this.preloadFilter === 'failures') {
      return list.filter((p: any) => {
        const h: any[] = p.history || [];
        return h.some((e: any) => {
          const o = e.outcome || e.reason;
          return o === 'discarded' || o === 'timeout' || o === 'error' || o === 'load-timeout' || o === 'load-error';
        });
      });
    }
    return list;
  }
}
