import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { ConfigLoaderService } from './services/config-loader.service';
import { ConfigData } from './models';

describe('AppComponent', () => {
  beforeEach(async () => {
    // Minimal chrome API mocks required by AppComponent
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: (_keys: any, cb: any) => cb({}),
          set: (_data: any, cb?: any) => cb && cb(),
        },
      },
      runtime: {
        sendMessage: (_msg: any, _opt?: any, cb?: any) => cb && cb({}),
      },
      extension: {
        isAllowedFileSchemeAccess: (cb: any) => cb(true),
      },
    };
    await TestBed.configureTestingModule({
      imports: [AppComponent, HttpClientTestingModule],
      providers: [
        {
          provide: ConfigLoaderService,
          useValue: {
            loadFromFile: (_file: File, _validate: boolean) => of(new ConfigData({ pages: [{ url: 'https://x', delaySeconds: 5, reloadIntervalSeconds: 0 }], isFullscreen: false, preventWindowFocus: false })),
            saveToFile: () => {},
          },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('imports local config successfully (importConfigFromFile)', (done) => {
    const fixture = TestBed.createComponent(AppComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();
    const mockFile = new File([JSON.stringify({ pages: [{ url: 'https://x', delaySeconds: 5, reloadIntervalSeconds: 0 }], isFullscreen: false })], 'config.json', { type: 'application/json' });
    comp.importConfigFromFile(mockFile);
    setTimeout(() => {
      fixture.detectChanges();
      try {
        expect(comp.localConfig).toBeTruthy();
        expect(comp.localConfig?.pages?.[0]?.url).toBe('https://x');
        expect(comp.importError).toBeUndefined();
        done();
      } catch (e) {
        if ((done as any).fail) { (done as any).fail(e); } else { throw e; }
      }
    }, 0);
  });

  it('surfaces import error when service fails', (done) => {
    // Override provider to simulate failure BEFORE component creation
    const failingLoader = {
      loadFromFile: () => throwError(() => new Error('parse failure')),
      saveToFile: () => {},
    } as any;
    TestBed.overrideProvider(ConfigLoaderService, { useValue: failingLoader });
    const fixture = TestBed.createComponent(AppComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();
    const badFile = new File(['{ invalid json'], 'bad.json', { type: 'application/json' });
    comp.importConfigFromFile(badFile);
    setTimeout(() => {
      fixture.detectChanges();
      try {
        expect(comp.localConfig?.pages?.length).toBe(0); // unchanged default
        expect(comp.importError).toContain('parse failure');
        const compiled = fixture.nativeElement as HTMLElement;
        expect(compiled.textContent).toContain('parse failure');
        done();
      } catch (e) {
        if ((done as any).fail) { (done as any).fail(e); } else { throw e; }
      }
    }, 0);
  });

  it('should render title', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Tabs Rotator / Slideshow');
  });

  it('toggles diagnostics panel visibility when wrench button clicked', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-diagnostics-panel')).toBeNull();
    const buttons = Array.from(compiled.querySelectorAll('button')) as HTMLButtonElement[];
    const wrenchBtn = buttons.find(b => b.getAttribute('aria-label') === 'Toggle Diagnostics');
    expect(wrenchBtn).toBeDefined();
    wrenchBtn!.click();
    fixture.detectChanges();
    expect(compiled.querySelector('app-diagnostics-panel')).not.toBeNull();
    wrenchBtn!.click();
    fixture.detectChanges();
    expect(compiled.querySelector('app-diagnostics-panel')).toBeNull();
  });

  it('exports local config via service', () => {
    const mockSave = jasmine.createSpy('saveToFile');
    // Override provider with spy
    TestBed.overrideProvider(ConfigLoaderService, { useValue: {
      loadFromFile: () => of(new ConfigData()),
      saveToFile: mockSave,
    }});
    const fixture = TestBed.createComponent(AppComponent);
    const comp = fixture.componentInstance;
    // Provide a local config
    comp.localConfig = new ConfigData({ pages: [{ url: 'https://export.test', delaySeconds: 5, reloadIntervalSeconds: 0 }], isFullscreen: false });
    comp.onExportLocalConfig();
    expect(mockSave).toHaveBeenCalledTimes(1);
    const args = mockSave.calls.mostRecent().args;
    expect(args[0].pages[0].url).toBe('https://export.test');
    expect(args[1]).toContain('tabs-rotator-config');
  });
});
