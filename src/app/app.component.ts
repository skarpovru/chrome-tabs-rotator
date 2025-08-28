import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
} from '@angular/core';
import { ConfigEditorComponent } from './config-editor/config-editor.component';
import { ConfigLoaderComponent } from './config-loader/config-loader.component';
import { DiagnosticsPanelComponent } from './diagnostics-panel/diagnostics-panel.component';
import { ConfigData, RemoteSettings, StorageKeys } from './models';
import { ConfigLoaderService } from './services/config-loader.service';

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ConfigEditorComponent,
    ConfigLoaderComponent,
    DiagnosticsPanelComponent,
  ],
})
export class AppComponent implements OnInit {
  isRotating = false;
  localConfig?: ConfigData;
  remoteSettings?: RemoteSettings;
  useRemoteConfig: boolean = false;
  isRotationDisabled: boolean = false;
  allowFileSchemeAccessMessage: boolean = false;

  // Diagnostics
  showDiagnostics = false;

  constructor(
    private cdr: ChangeDetectorRef,
    private configLoaderService: ConfigLoaderService
  ) {}

  ngOnInit() {
    this.loadStoredAppConfig();
    this.queryRotationState();
    chrome.extension.isAllowedFileSchemeAccess((isAllowed) => {
      console.debug('File scheme access allowed:', isAllowed);
      this.allowFileSchemeAccessMessage = !isAllowed;
      this.cdr.detectChanges();
    });
  }

  startRotation() {
    if (this.isRotationDisabled) {
      return;
    }
    this.isRotationDisabled = true;
    chrome.runtime.sendMessage({ action: 'rotateTabs' }).finally(() => {
      this.isRotating = true;
      this.isRotationDisabled = false;
      this.cdr.detectChanges();
    });
  }

  stopRotation() {
    if (this.isRotationDisabled) {
      return;
    }
    this.isRotationDisabled = true;
    chrome.runtime.sendMessage({ action: 'stopRotation' }).finally(() => {
      this.isRotating = false;
      this.isRotationDisabled = false;
      this.cdr.detectChanges();
    });
  }

  onChangeUseRemoteConfig(useRemoteConfig: boolean) {
    chrome.storage.local.set({
      [StorageKeys.UseRemoteConfig]: useRemoteConfig,
    });
    this.loadStoredConfigData(useRemoteConfig);
    this.useRemoteConfig = useRemoteConfig ?? false;
    this.cdr.detectChanges();
  }

  onExportLocalConfig() {
    if (this.localConfig) {
      this.configLoaderService.saveToFile(
        this.localConfig,
        'tabs-rotator-config.json'
      );
    }
  }

  onImportLocalConfig() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.configLoaderService.loadFromFile(file, false).subscribe({
          next: (config) => {
            this.onChangeLocalConfig(config, () => this.cdr.detectChanges());
          },
          error: (error) => {
            console.error('Error importing the configuration file', error);
          },
        });
      }
    };
    input.click();
  }

  onChangeLocalConfig(localConfig: ConfigData, onChanged?: () => void) {
    chrome.storage.local.set({ [StorageKeys.LocalConfig]: localConfig }, () => {
      this.localConfig = localConfig;
      console.debug('Local configuration saved', localConfig);
      onChanged?.();
    });
  }

  onChangeRemoteSettings(remoteSettings: RemoteSettings) {
    chrome.storage.local.set(
      { [StorageKeys.RemoteSettings]: remoteSettings },
      () => {
        console.debug('Settings for loading remote configuration was saved');
      }
    );
  }

  onChangeRemoteConfig(remoteConfig: ConfigData) {
    chrome.storage.local.set(
      { [StorageKeys.RemoteConfig]: remoteConfig },
      () => {
        console.debug('Remote configuration saved', remoteConfig);
      }
    );
  }

  toggleDiagnostics() {
    this.showDiagnostics = !this.showDiagnostics;
    this.cdr.detectChanges();
  }

  private loadStoredConfigData(useRemoteConfig: boolean) {
    if (useRemoteConfig) {
      this.localConfig = undefined;
      this.loadStoredRemoteSettings();
    } else {
      this.remoteSettings = undefined;
      this.loadStoredLocalConfig();
    }
  }

  private loadStoredAppConfig() {
    chrome.storage.local.get([StorageKeys.UseRemoteConfig], (result) => {
      this.useRemoteConfig = result?.[StorageKeys.UseRemoteConfig] ?? false; // Default to false if not set
      this.loadStoredConfigData(this.useRemoteConfig);
      console.debug('Use remote config flag loaded', this.useRemoteConfig);
      this.cdr.detectChanges();
    });
  }

  private loadStoredRemoteSettings() {
    chrome.storage.local.get([StorageKeys.RemoteSettings], (result) => {
      this.remoteSettings =
        (result?.[StorageKeys.RemoteSettings] as RemoteSettings) ||
        new RemoteSettings();
      console.debug(
        'Settings for loading remote configuration loaded',
        this.remoteSettings
      );
      this.cdr.detectChanges();
    });
  }

  private loadStoredLocalConfig() {
    chrome.storage.local.get([StorageKeys.LocalConfig], (result) => {
      this.localConfig =
        (result?.[StorageKeys.LocalConfig] as ConfigData) || new ConfigData();
      console.debug('Local configuration loaded', this.localConfig);
      this.cdr.detectChanges();
    });
  }

  private queryRotationState() {
    chrome.runtime.sendMessage({ action: 'getRotationState' }, (response) => {
      this.isRotating = response.isRotating;
      this.cdr.detectChanges();
    });
  }
}
