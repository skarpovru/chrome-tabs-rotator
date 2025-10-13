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
}
