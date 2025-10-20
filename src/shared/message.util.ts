// Unified safe messaging utility to suppress noisy runtime.lastError when no listeners are present.
// Assumes MV3 environment where global 'chrome' is available.
// Provides minimal overloads for convenience.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const chrome: any; // Rely on chrome-types in consuming build; keeps this file lightweight.

export interface SafeSendOptions {
  /** When true and runtime.lastError is present, logs a debug message (suppressed by default). */
  logOnError?: boolean;
  /** Optional tag prefix for debug logging when logOnError is true. */
  verboseTag?: string;
}

export function safeRuntimeSend<T = any>(message: T): void;
// (message, callback) 2-arg form
export function safeRuntimeSend<T = any>(message: T, cb: (response: any) => void): void;
// (message, options, callback) 3-arg form
export function safeRuntimeSend<T = any>(message: T, options: SafeSendOptions | undefined, cb?: (response: any) => void): void;
export function safeRuntimeSend<T = any>(message: T, options?: SafeSendOptions | ((resp: any) => void), cb?: (response: any) => void): void {
  try {
    const callback = (response: any) => {
      // Swallow lastError if present (no-op access marks it handled)
      const lastErr = (chrome as any)?.runtime?.lastError as { message?: string } | undefined;
      const opts: SafeSendOptions | undefined = typeof options === 'function' ? undefined : options;
      if (lastErr && opts?.logOnError) {
        try {
          const tag = opts.verboseTag ? `[${opts.verboseTag}]` : '[msg]';
          // Use console.debug so production logs stay quiet unless user opens verbose panel.
          // eslint-disable-next-line no-console
          console.debug(`${tag} runtime.lastError`, lastErr.message, { message });
        } catch {}
      }
      try {
        if (typeof options === 'function') {
          (options as any)(response);
        } else if (typeof cb === 'function') {
          cb(response);
        }
      } catch {}
    };

    if (typeof options === 'function') {
      chrome.runtime?.sendMessage(message as any, callback);
    } else if (options) {
      chrome.runtime?.sendMessage(message as any, options, callback);
    } else {
      chrome.runtime?.sendMessage(message as any, callback);
    }
  } catch (e) {
    // Intentionally ignored; background may be shutting down.
  }
}
