// Custom Angular test loader limited to app/ specs only.
import 'zone.js/testing';
import { getTestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';

getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());

// Require all app spec files (Webpack context replacement handled by Angular CLI)
const appSpecContext = (require as any).context('./app', true, /\.spec\.ts$/);
appSpecContext.keys().forEach(appSpecContext);
