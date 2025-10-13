import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, NgZone } from '@angular/core';
import { safeRuntimeLastError } from '../../shared';
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

  private countdownSub?: any;
  countdownSeconds?: number;

  constructor(private cdr: ChangeDetectorRef, private zone: NgZone, private countdownState: CountdownStateService) {}

  ngOnInit() {
    this.refresh();
    try { chrome.runtime.sendMessage({ action: 'uiHello' }); } catch {}
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
  chrome.runtime.sendMessage({ action: 'getDiagnostics' }, undefined, (res: any) => {
    const lastErr = safeRuntimeLastError();
      if (lastErr) {
        this.error = lastErr || 'Message failed.';
        this.diags = null;
      } else if (!res || (res.ok === false && !res.diagnostics)) {
        this.error = (res && (res.error || res.status)) || 'Failed to load diagnostics.';
        this.diags = null;
      } else {
        this.diags = res?.diagnostics ?? res;
      }
      this.loading = false;
      this.cdr.detectChanges();
    });
  }

  fixExtras() {
    this.loading = true;
    this.error = undefined;
  chrome.runtime.sendMessage({ action: 'enforceInvariant' }, undefined, (res: any) => {
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
  chrome.runtime.sendMessage({ action: 'forceRotateNow' }, undefined, (res: any) => {
    const lastErr = safeRuntimeLastError();
      if (lastErr) {
        this.error = lastErr || 'Message failed.';
      } else if (!res || res.ok === false) {
        this.error = (res && res.error) || 'Force rotate failed.';
      } else if (res.diagnostics) {
        this.diags = res.diagnostics;
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
      chrome.runtime.sendMessage({ action: 'setDebugActivationLogging', value: nextVal }, undefined, (res: any) => {
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
      chrome.runtime.sendMessage({ action: 'setPreserveMaxAge', value: num }, undefined, (res: any) => {
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
      chrome.runtime.sendMessage({ action: 'clearActivationError' }, undefined, (res: any) => {
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
      chrome.runtime.sendMessage({ action: 'clearActivationHistory' }, undefined, (res: any) => {
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
}
