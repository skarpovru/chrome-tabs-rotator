// Utility to safely access chrome.runtime.lastError without depending on type declarations
// Returns the message string or undefined if not present.
export function safeRuntimeLastError(): string | undefined {
  try {
    const anyChrome: any = chrome as any;
    const msg: string | undefined = anyChrome?.runtime?.lastError?.message;
    return msg;
  } catch {
    return undefined;
  }
}
