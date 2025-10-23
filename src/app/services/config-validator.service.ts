import { Injectable } from '@angular/core';
import { ConfigData } from '../models/config-data.model';
import { PageConfig } from '../models/page-config.model';

@Injectable({
  providedIn: 'root',
})
export class ConfigValidatorService {
  validateConfigData(configData: ConfigData): boolean {
    const errors: string[] = [];
    if (!configData || typeof configData !== 'object') {
      errors.push('config must be an object.');
    }
    if (!Array.isArray(configData?.pages)) {
      errors.push('pages must be an array.');
    } else if (configData.pages.length === 0) {
      errors.push('pages must contain at least one page.');
    } else {
      for (let i = 0; i < configData.pages.length; i++) {
        const page = configData.pages[i];
        this.collectErrors(() => this.validatePageConfig(page, i), errors);
      }
    }
    // Optional top-level flags validation
    if (configData?.isFullscreen != null && typeof configData.isFullscreen !== 'boolean') {
      errors.push('isFullscreen must be boolean.');
    }
    if (configData?.preventWindowFocus != null && typeof configData.preventWindowFocus !== 'boolean') {
      errors.push('preventWindowFocus must be boolean.');
    }

    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.join(' ')}`);
    }

    return true;
  }

  validatePageConfig(pageConfig: PageConfig, index: number): boolean {
    const errors: string[] = [];
    const url = pageConfig?.url;
    if (!url || url.trim().length === 0) {
      errors.push(`pages[${index}].url must be a non-empty string.`);
    } else if (!/^(https?:|file:\/\/)/i.test(url.trim())) {
      errors.push(`pages[${index}].url must start with http://, https:// or file://.`);
    }
    const delay = pageConfig?.delaySeconds;
    if (typeof delay !== 'number' || !isFinite(delay)) {
      errors.push(`pages[${index}].delaySeconds must be a finite number.`);
    } else if (delay < 3) {
      errors.push(`pages[${index}].delaySeconds must be ≥ 3.`);
    }
    const ri = pageConfig?.reloadIntervalSeconds;
    if (typeof ri !== 'number' || !isFinite(ri)) {
      errors.push(`pages[${index}].reloadIntervalSeconds must be a finite number.`);
    } else if (ri < 0) {
      errors.push(`pages[${index}].reloadIntervalSeconds must be ≥ 0.`);
    }

    if (errors.length > 0) {
      // Do not prefix with 'Validation failed:' here to avoid double prefixing at aggregate level.
      throw new Error(errors.join(' '));
    }

    return true;
  }

  private collectErrors(validationFn: () => boolean, errors: string[]): void {
    try {
      validationFn();
    } catch (error) {
      if (error instanceof Error) {
        errors.push(error.message);
      }
    }
  }
}
