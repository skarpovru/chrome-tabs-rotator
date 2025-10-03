/**
 * StorageService
 * --------------
 * Wraps chrome.storage.local to provide a promise-based, typed-friendly API and
 * centralize error handling / future migrations.
 */
export class StorageService {
  // Simple in-memory cache with TTL (ms)
  private cache = new Map<string, { v: any; exp: number }>();
  private defaultTtlMs = 5000; // 5s default TTL for frequently accessed keys

  constructor(private ttlMs: number = 5000) {
    if (ttlMs > 0) this.defaultTtlMs = ttlMs; // allow override
  }

  private getFromCache<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.exp) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.v as T;
  }

  private putInCache(key: string, value: any) {
    if (this.defaultTtlMs <= 0) return;
    this.cache.set(key, { v: value, exp: Date.now() + this.defaultTtlMs });
  }

  async get<T = any>(key: string): Promise<T | undefined> {
    try {
      const cached = this.getFromCache<T>(key);
      if (cached !== undefined) return cached;
      const result = await chrome.storage.local.get(key);
      const val = result?.[key] as T | undefined;
      if (val !== undefined) this.putInCache(key, val);
      return val;
    } catch (e) {
      console.error('[storage] get failed', key, e);
      return undefined;
    }
  }

  async getMany<T = any>(keys: string[]): Promise<Record<string, T | undefined>> {
    try {
      const result = await chrome.storage.local.get(keys);
      const out: Record<string, T | undefined> = {};
      for (const k of keys) out[k] = result?.[k] as T | undefined;
      return out;
    } catch (e) {
      console.error('[storage] getMany failed', keys, e);
      return {};
    }
  }

  async set(values: Record<string, any>): Promise<void> {
    try {
      await chrome.storage.local.set(values);
      // Invalidate / update cache entries for changed keys
      for (const k of Object.keys(values)) {
        this.putInCache(k, values[k]);
      }
    } catch (e) {
      console.error('[storage] set failed', Object.keys(values), e);
      throw e;
    }
  }

  async remove(keys: string | string[]): Promise<void> {
    try {
      await chrome.storage.local.remove(keys);
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) this.cache.delete(k);
    } catch (e) {
      console.error('[storage] remove failed', keys, e);
      throw e;
    }
  }
}
