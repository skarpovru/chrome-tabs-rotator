import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component } from '@angular/core';

@Component({
  selector: 'app-diagnostics-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './diagnostics-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiagnosticsPanelComponent {
  loading = false;
  error?: string;
  diags: any = null;
  autoRefresh = false;
  private timer?: any;

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.refresh();
  }

  ngOnDestroy() {
    this.stopAuto();
  }

  refresh() {
    this.loading = true;
    this.error = undefined;
    chrome.runtime.sendMessage({ action: 'getDiagnostics' }, (res) => {
      const lastErr = chrome.runtime.lastError;
      if (lastErr) {
        this.error = lastErr.message || 'Message failed.';
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
    chrome.runtime.sendMessage({ action: 'enforceInvariant' }, (res) => {
      const lastErr = chrome.runtime.lastError;
      if (lastErr) {
        this.error = lastErr.message || 'Message failed.';
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
}
