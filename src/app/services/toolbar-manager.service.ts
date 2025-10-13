import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ToolbarManagerService {
  /**
   * Change the extension icon based on the rotation state
   */
  async trySetToolbarIcon(isRotating: boolean): Promise<void> {
    const anyChrome: any = (globalThis as any).chrome;
    if (!anyChrome?.action?.setIcon) {
      // Avoid noisy errors in test / non-extension environments.
      if (!(anyChrome as any).__toolbarWarned) {
        (anyChrome as any).__toolbarWarned = true;
        console.debug('[toolbar] setIcon unavailable; skipping.');
      }
      return;
    }
    console.debug('Setting toolbar icon:', isRotating);
    const iconPath = isRotating
      ? 'assets/icons/change-exchange-red-icon'
      : 'assets/icons/change-exchange-icon';
    try {
      await anyChrome.action.setIcon({
        path: {
          '16': iconPath + '16.png',
          '48': iconPath + '48.png',
          '128': iconPath + '128.png',
        },
      });
    } catch (error) {
      console.error('Failed to set toolbar icon:', error);
    }
  }
}
