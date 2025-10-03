import { StorageKeys, TabConfig } from '../app/models';
import { StorageService } from './storage.service';

export interface ActivationRecord {
  at: number; tabId: number; pageIndex: number; success: boolean; stage: string; error?: string | null;
}

export class ActivationDiagnosticsService {
  private history: ActivationRecord[] = [];
  private lastError: string | null = null;
  private lastSuccessAt: number | null = null;
  private readonly maxHistory = 30;

  constructor(private storage: StorageService) {}

  async init(): Promise<void> {
    try {
      const stored = (await this.storage.get<ActivationRecord[]>(StorageKeys.ActivationHistory)) || [];
      this.history = Array.isArray(stored) ? stored : [];
      if (this.history.length > this.maxHistory) {
        this.history.splice(0, this.history.length - this.maxHistory);
        try { await this.storage.set({ [StorageKeys.ActivationHistory]: this.history }); } catch {}
      }
      const lastOk = [...this.history].reverse().find(r => r.success);
      if (lastOk) this.lastSuccessAt = lastOk.at;
    } catch {}
  }

  setLastError(err: string | null) { this.lastError = err; }
  getLastError(): string | null { return this.lastError; }
  getLastSuccessAt(): number | null { return this.lastSuccessAt; }
  getHistory(): ActivationRecord[] { return this.history; }

  async clearHistory(): Promise<void> {
    this.history = [];
    this.lastSuccessAt = null;
    try { await this.storage.set({ [StorageKeys.ActivationHistory]: [] }); } catch {}
  }

  clearError() { this.lastError = null; }

  async record(ev: { success: boolean; stage: string; tabId: number; pageIndex: number; error?: string | null }): Promise<void> {
    const rec: ActivationRecord = { at: Date.now(), ...ev };
    this.history.push(rec);
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }
    if (ev.success) this.lastSuccessAt = rec.at;
    try { await this.storage.set({ [StorageKeys.ActivationHistory]: this.history }); } catch {}
  }

  computeHealthBadgeColor(tabsConfig?: { tabs?: TabConfig[] }): string {
    const now = Date.now();
    const lastOk = this.lastSuccessAt;
    const recentFailures = this.history.slice(-5).filter(a => !a.success).length;
    if (!lastOk) return '#9b1c1c';
    const ageSec = (now - lastOk) / 1000;
    if (recentFailures >= 5) return '#b91c1c';
    const meanDelay = this.estimateMeanDelaySeconds(tabsConfig);
    if (ageSec <= 60 || ageSec <= meanDelay * 2) return '#15803d';
    if (ageSec <= 300) return '#ca8a04';
    return '#dc2626';
  }

  estimateMeanDelaySeconds(tabsConfig?: { tabs?: TabConfig[] }): number {
    const tabs = tabsConfig?.tabs;
    if (!tabs?.length) return 30;
    const vals = tabs.map(t => Number(t.page?.delaySeconds) || 0).filter(v => v > 0);
    if (!vals.length) return 30;
    return vals.reduce((a,b)=>a+b,0)/vals.length;
  }
}
