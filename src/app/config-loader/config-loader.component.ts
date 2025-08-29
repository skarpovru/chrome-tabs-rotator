import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  Output,
  OnInit,
} from '@angular/core';
import { ConfigLoaderService } from '../services/config-loader.service';
import { ConfigData, RemoteSettings } from '../models';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  FormControl,
  Validators,
} from '@angular/forms';

@Component({
    selector: 'app-config-loader',
    templateUrl: './config-loader.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, FormsModule, ReactiveFormsModule]
})
export class ConfigLoaderComponent implements OnInit {
  @Output() valueChanges = new EventEmitter<ConfigData>();
  @Output() settingsChanges = new EventEmitter<RemoteSettings>();

  @Input() set initialSettings(remoteSettings: RemoteSettings) {
    this.remoteSettings = remoteSettings;
    this.configUrlControl?.setValue(remoteSettings.configUrl, {
      emitEvent: false,
    });
    this.configReloadIntervalControl?.setValue(
      remoteSettings.configReloadIntervalMinutes
    );
    this.cdr.detectChanges();
  }

  configUrlControl = new FormControl('', [Validators.required]);
  configReloadIntervalControl = new FormControl(0, [
    Validators.required,
    Validators.min(0),
  ]);

  remoteSettings?: RemoteSettings;
  configData?: ConfigData;
  error?: string;
  form: FormGroup;

  constructor(
    private fb: FormBuilder,
    private configLoaderService: ConfigLoaderService,
    private cdr: ChangeDetectorRef
  ) {
    this.form = this.fb.group({
      configUrl: this.configUrlControl,
      configReloadIntervalMinutes: this.configReloadIntervalControl,
    });

    this.form?.valueChanges.subscribe((remoteSettings) => {
      this.remoteSettings = remoteSettings;
      this.settingsChanges.emit(remoteSettings);
      this.cdr.detectChanges();
    });
  }

  ngOnInit() {
    this.loadConfig();
  }

  onLoadConfig(event: Event) {
    event.preventDefault();
    this.loadConfig();
  }

  private loadConfig() {
    const configUrl = this.configUrlControl?.value;
    this.error = undefined;
    if (!configUrl || configUrl?.length === 0) {
      return;
    }

    this.configLoaderService.loadFromUrl(configUrl).subscribe({
      next: (configData) => {
        console.debug('Remote configuration loaded and saved', configData);
        this.configData = configData;
        this.valueChanges.emit(configData);
        this.cdr.detectChanges();
      },
      error: (error) => {
        this.error = error;
        this.cdr.detectChanges();
      },
    });
  }
}
