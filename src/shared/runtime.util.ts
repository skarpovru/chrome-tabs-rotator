// Shared runtime-related helpers
// Declare a loose global chrome variable so TypeScript doesn't error in non-extension compile contexts.
declare const chrome: any;
export function safeRuntimeLastError(): string | undefined {
  try {
    return (chrome as any)?.runtime?.lastError?.message;
  } catch {
    return undefined;
  }
}
