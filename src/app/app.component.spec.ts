import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { HttpClientTestingModule } from '@angular/common/http/testing';

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
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
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
});
