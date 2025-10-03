// Unified safe messaging utility to suppress noisy runtime.lastError when no listeners are present.
// Assumes MV3 environment where global 'chrome' is available.
// Provides minimal overloads for convenience.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const chrome: any; // Rely on chrome-types in consuming build; keeps this file lightweight.

export interface SafeSendOptions { }

export function safeRuntimeSend<T = any>(message: T): void;
export function safeRuntimeSend<T = any>(message: T, options: SafeSendOptions | undefined, cb?: (response: any) => void): void;
export function safeRuntimeSend<T = any>(message: T, options?: SafeSendOptions, cb?: (response: any) => void): void {
  try {
    chrome.runtime?.sendMessage(message as any, undefined, (response: any) => {
      // Swallow lastError if present (no-op access marks it handled)
      const _ = (chrome as any)?.runtime?.lastError; // eslint-disable-line @typescript-eslint/no-unused-vars
      try { cb?.(response); } catch {}
    });
  } catch (e) {
    // Intentionally ignored; background may be shutting down.
  }
}
