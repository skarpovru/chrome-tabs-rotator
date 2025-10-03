// Discriminated union types for runtime messaging
export type ControlMessage =
  | { action: 'rotateTabs' }
  | { action: 'stopRotation' }
  | { action: 'getRotationState' }
  | { action: 'getDiagnostics' }
  | { action: 'enforceInvariant' }
  | { action: 'forceRotateNow' };

export interface RotationStateResponse { ok: true; isRotating: boolean }
export interface DiagnosticsResponse { ok: boolean; diagnostics?: any; error?: string }
export interface GenericOk { ok: boolean; [k: string]: any }

export type OutboundMessage =
  | { kind: 'metrics'; event: { counters: Record<string, number>; [k: string]: any } }
  | { kind: 'countdown'; seconds: number; nextAt: number };

export type AnyInboundMessage = ControlMessage | OutboundMessage | { [k: string]: any };
