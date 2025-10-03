import { ConfigData, RemoteSettings, StorageKeys } from '../app/models';
import { ConfigValidatorService } from '../app/services';
import { CustomHttpClient } from './custom-http-client.service';
import { StorageService } from './storage.service';

/**
 * ConfigService
 * -----------------
 * Responsible for loading, validating and caching configuration data
 * from local storage and/or remote endpoint. RotationService will delegate
 * all configuration retrieval to this service after refactor.
 */
export class ConfigService {
  private currentConfig?: ConfigData;
  private currentRemoteSettings?: RemoteSettings;

  constructor(
    private http: CustomHttpClient,
    private validator: ConfigValidatorService,
    private storage: StorageService = new StorageService()
  ) {}

  /** Return the last loaded (effective) config if present. */
  get config(): ConfigData | undefined {
    return this.currentConfig;
  }

  /** Return cached remote settings if present. */
  get remoteSettings(): RemoteSettings | undefined {
    return this.currentRemoteSettings;
  }

  /**
   * Loads configuration + (optionally) remote settings from chrome.storage.local.
   * Mirrors existing logic in RotationService.loadActualConfigurationFromLocalStorage.
   */
  async loadFromStorage(): Promise<{
    loadedConfig: ConfigData;
    loadedRemoteSettings?: RemoteSettings;
    useRemote: boolean;
  }> {
    // Migration: move any legacy capitalized keys to new lowercase enum keys
    const migrateKey = async (oldKey: string, newKey: string) => {
      const existingNew = await this.storage.get<any>(newKey);
      if (existingNew !== undefined) return; // already have new
      const legacy = await this.storage.get<any>(oldKey);
      if (legacy !== undefined) {
        await this.storage.set({ [newKey]: legacy });
        await this.storage.remove(oldKey);
      }
    };
    await migrateKey('UseRemoteConfig', StorageKeys.UseRemoteConfig);
    await migrateKey('LocalConfig', StorageKeys.LocalConfig);
    await migrateKey('RemoteConfig', StorageKeys.RemoteConfig);
    await migrateKey('RemoteSettings', StorageKeys.RemoteSettings);

    const useRemote =
      (await this.storage.get<boolean>(StorageKeys.UseRemoteConfig)) || false;

    if (useRemote) {
      const loadedRemoteSettings = await this.storage.get<RemoteSettings>(
        StorageKeys.RemoteSettings
      );
      const loadedConfig =
        (await this.storage.get<ConfigData>(StorageKeys.RemoteConfig)) ||
        new ConfigData();
      this.currentConfig = loadedConfig;
      this.currentRemoteSettings = loadedRemoteSettings;
      return { loadedConfig, loadedRemoteSettings, useRemote };
    } else {
      const loadedConfig =
        (await this.storage.get<ConfigData>(StorageKeys.LocalConfig)) ||
        new ConfigData();
      this.currentConfig = loadedConfig;
      return { loadedConfig, useRemote };
    }
  }

  /** Fetch remote config from URL (no caching beyond updating currentConfig). */
  async fetchRemoteConfig(url: string): Promise<ConfigData | undefined> {
    try {
      const cfg = await this.http.get<ConfigData>(url);
      this.validator.validateConfigData(cfg);
      this.currentConfig = cfg;
      return cfg;
    } catch (e) {
      console.error('[config] Failed to fetch or validate remote config', e);
      return undefined;
    }
  }
}
