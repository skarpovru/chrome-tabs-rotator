import { StorageKeys } from '../app/models';

/**
 * SchedulerService
 * ----------------
 * Thin abstraction over chrome.alarms to centralize naming, logging, and
 * facilitate future mocking in tests. All alarm interactions should flow
 * through this service rather than direct chrome.alarms calls.
 */
export interface ScheduleOptions {
  /** Absolute time (ms since epoch) when the alarm should fire */
  when?: number;
  /** Period in minutes for recurring alarms */
  periodInMinutes?: number;
}

export interface ScheduledAlarmInfo {
  name: string;
  scheduledTime?: number;
  periodInMinutes?: number;
}

export class SchedulerService {
  static readonly RELOAD_PREFIX = 'reload:';

  buildReloadAlarmName(tabId: number): string {
    return `${SchedulerService.RELOAD_PREFIX}${tabId}`;
  }

  async scheduleReload(tabId: number, delaySeconds: number): Promise<void> {
    if (!tabId || tabId <= 0) return;
    await this.create(this.buildReloadAlarmName(tabId), {
      when: Date.now() + delaySeconds * 1000,
    });
  }

  async clearReload(tabId: number): Promise<void> {
    if (!tabId || tabId <= 0) return;
    await this.clear(this.buildReloadAlarmName(tabId));
  }

  async clearAllReloads(): Promise<void> {
    await this.clearByPrefix(SchedulerService.RELOAD_PREFIX);
  }
  /** Create (or replace) a one-off or periodic alarm */
  async create(name: string, options: ScheduleOptions): Promise<void> {
    const { when, periodInMinutes } = options;
    try {
      void chrome?.alarms?.create?.(name, { when, periodInMinutes });
    } catch {}
  }

  /** Convenience: schedule to fire after a delay (ms) */
  async scheduleIn(name: string, delayMs: number): Promise<void> {
    try {
      void chrome?.alarms?.create?.(name, {
        when: Date.now() + Math.max(0, delayMs),
      });
    } catch {}
  }

  /** Clear specific alarm */
  async clear(name: string): Promise<boolean> {
    try {
      return await chrome?.alarms?.clear?.(name);
    } catch {
      return false;
    }
  }

  /** Clear all alarms whose name starts with the given prefix */
  async clearByPrefix(prefix: string): Promise<void> {
    try {
      const all = (await chrome?.alarms?.getAll?.()) || [];
      await Promise.all(
        all
          .filter((a: any) => a?.name?.startsWith?.(prefix))
          .map((a: any) => chrome?.alarms?.clear?.(a.name))
      );
    } catch {}
  }

  /** Retrieve a single alarm */
  async get(name: string): Promise<ScheduledAlarmInfo | undefined> {
    let a: any;
    try {
      a = await chrome?.alarms?.get?.(name);
    } catch {
      a = undefined;
    }
    if (!a) return undefined;
    return {
      name: a.name,
      scheduledTime: a.scheduledTime,
      periodInMinutes: a.periodInMinutes,
    };
  }

  /** Retrieve all alarms */
  async getAll(): Promise<ScheduledAlarmInfo[]> {
    try {
      const all = (await chrome?.alarms?.getAll?.()) || [];
      return all.map((a: any) => ({
        name: a.name,
        scheduledTime: a.scheduledTime,
        periodInMinutes: a.periodInMinutes,
      }));
    } catch {
      return [];
    }
  }
}
