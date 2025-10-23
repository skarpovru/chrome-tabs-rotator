import { ConfigValidatorService } from './config-validator.service';
import { ConfigData } from '../models/config-data.model';
import { PageConfig } from '../models/page-config.model';

describe('ConfigValidatorService file:// scheme', () => {
  let service: ConfigValidatorService;
  beforeEach(() => { service = new ConfigValidatorService(); });

  it('accepts file:// URLs', () => {
    const cfg = new ConfigData({
      pages: [ new PageConfig({ url: 'file:///C:/docs/report.pdf', delaySeconds: 5, reloadIntervalSeconds: 30 }) ]
    });
    expect(service.validateConfigData(cfg)).toBeTrue();
  });

  it('rejects unsupported schemes (ftp)', () => {
    const cfg = new ConfigData({
      pages: [ new PageConfig({ url: 'ftp://example.com/file', delaySeconds: 5, reloadIntervalSeconds: 30 }) ]
    });
    expect(() => service.validateConfigData(cfg)).toThrowError(/must start with http:\/\/,/); // general pattern
  });
});
