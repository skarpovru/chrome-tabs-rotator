import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ConfigLoaderService } from './config-loader.service';
import { ConfigValidatorService } from './config-validator.service';

describe('ConfigLoaderService remote', () => {
  let service: ConfigLoaderService;
  let httpMock: HttpTestingController;
  let validator: ConfigValidatorService;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ConfigLoaderService, ConfigValidatorService]
    });
    service = TestBed.inject(ConfigLoaderService);
    httpMock = TestBed.inject(HttpTestingController);
    validator = TestBed.inject(ConfigValidatorService);
    spyOn(validator, 'validateConfigData').and.callThrough();
  });
  afterEach(() => httpMock.verify());

  it('loads and validates remote config successfully', (done) => {
    const url = 'https://remote.example/conf.json';
    service.loadFromUrl(url).subscribe({
      next: cfg => {
        expect(cfg.pages.length).toBe(1);
        expect(validator.validateConfigData).toHaveBeenCalled();
        done();
      },
      error: e => done.fail(e)
    });
    const req = httpMock.expectOne(url);
    req.flush({ pages: [{ url: 'https://a.example', delaySeconds: 5, reloadIntervalSeconds: 0 }], isFullscreen: false });
  });

  it('emits validation error for invalid config', (done) => {
    const url = 'https://remote.example/bad.json';
    service.loadFromUrl(url).subscribe({
      next: () => done.fail('Should not succeed'),
      error: err => {
        expect(String(err)).toContain('Validation failed');
        expect(validator.validateConfigData).toHaveBeenCalled();
        done();
      }
    });
    const req = httpMock.expectOne(url);
    req.flush({ pages: [{ url: 'ftp://bad', delaySeconds: 1, reloadIntervalSeconds: 0 }] });
  });

  it('maps 404 to File not found', (done) => {
    const url = 'https://remote.example/missing.json';
    service.loadFromUrl(url).subscribe({
      next: () => done.fail('Should not succeed'),
      error: err => {
        expect(String(err)).toContain('File not found');
        done();
      }
    });
    const req = httpMock.expectOne(url);
    req.flush('Not found', { status: 404, statusText: 'Not Found' });
  });

  it('handles network error status=0', (done) => {
    const url = 'https://remote.example/network.json';
    service.loadFromUrl(url).subscribe({
      next: () => done.fail('Should not succeed'),
      error: err => {
        expect(String(err)).toContain('Network error');
        done();
      }
    });
    const req = httpMock.expectOne(url);
    req.error(new ProgressEvent('error'));
  });

  it('skips validation when withValidation=false', (done) => {
    const url = 'https://remote.example/no-validate.json';
    service.loadFromUrl(url, false).subscribe({
      next: cfg => {
        expect(validator.validateConfigData).not.toHaveBeenCalled();
        expect(cfg.pages.length).toBe(1);
        done();
      },
      error: e => done.fail(e)
    });
    const req = httpMock.expectOne(url);
    req.flush({ pages: [{ url: 'ftp://still-bad', delaySeconds: 5, reloadIntervalSeconds: 0 }] });
  });
});
