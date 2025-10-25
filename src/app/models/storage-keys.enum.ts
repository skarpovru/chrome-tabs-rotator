/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Supported keys for storage.
 */
export enum StorageKeys {
  UseRemoteConfig = 'useRemoteConfig',
  LocalConfig = 'localConfig',
  RemoteSettings = 'remoteSettings',
  RemoteConfig = 'remoteConfig',
  RotationState = 'rotationState',
  DebugActivationLogging = 'debugActivationLogging',
  ActivationHistory = 'activationHistory',
  RotationHeartbeat = 'rotationHeartbeat', // periodically updated while rotating (last healthy activity timestamp)
  PreservedResumeAt = 'preservedResumeAt', // timestamp of last preserved resume initialization
  PreserveHeartbeatMaxAgeSeconds = 'preserveHeartbeatMaxAgeSeconds', // user-configurable max age threshold
  InitializationError = 'initializationError', // last initialization error message
  InitializationErrorMeta = 'initializationErrorMeta', // JSON with { at:number, stack?:string }
  ForcePreserveNextInit = 'forcePreserveNextInit', // e2e / crash recovery flag to force initialize({preserveExisting:true}) once
  DisableAutoPreserveNextInit = 'disableAutoPreserveNextInit', // e2e flag to prevent auto-preserve for negative tests
  TabsConfigSnapshot = 'tabsConfigSnapshot', // persisted subset of tabsConfig including suspended & network error metadata
}
