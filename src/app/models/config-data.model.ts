import { PageConfig } from './page-config.model';

export class ConfigData {
  /**
   * Array of page configurations.
   */
  pages: PageConfig[] = [];

  /**
   * Indicates if the pages should be shown is in fullscreen mode.
   */
  isFullscreen: boolean = true;

  /**
   * Indicates if the extension should avoid forcing window focus.
   */
  preventWindowFocus?: boolean;


  constructor(init?: Partial<ConfigData>) {
    Object.assign(this, init);
  }
}
