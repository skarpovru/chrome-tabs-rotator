// Custom Angular test loader limited to app/ specs only.
import 'zone.js/testing';
// Declare require for bundler/ESM TS compile (Angular test builder still provides webpack require)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: any;
import { getTestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';

getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());

// Require all app spec files (Webpack context replacement handled by Angular CLI)
const appSpecContext = (require as any).context('./app', true, /\.spec\.ts$/);
appSpecContext.keys().forEach(appSpecContext);
