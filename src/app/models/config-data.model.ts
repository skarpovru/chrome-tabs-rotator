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

  /**
   * When true, local `file://` pages use the legacy in-place reload strategy (no preload tab creation).
   * When false (default), local file pages behave like normal web pages: a hidden preload tab is
   * created to load a fresh copy before promotion, improving perceived freshness for heavy local pages.
   */
  reuseLocalFileTabs?: boolean;


  constructor(init?: Partial<ConfigData>) {
    Object.assign(this, init);
    // Explicit default: unless user opt-in, treat local file pages like others (preload enabled)
    if (this.reuseLocalFileTabs == null) this.reuseLocalFileTabs = false;
  }
}
