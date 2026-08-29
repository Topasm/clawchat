import { platformApi } from '../platform';
import { IS_DESKTOP, IS_WEB } from '../types/platform';

interface BadgingNavigator extends Navigator {
  setAppBadge(count?: number): Promise<void>;
  clearAppBadge(): Promise<void>;
}

/**
 * Updates the native app icon badge count across all platforms.
 * - Tauri: uses the native badge command
 * - Web: uses navigator.setAppBadge (W3C Badging API)
 */
export async function setAppBadge(count: number): Promise<void> {
  const safeCount = Math.max(0, Math.round(count));

  try {
    if (IS_DESKTOP) {
      await platformApi.notifications.setBadgeCount(safeCount);
    } else if (IS_WEB && 'setAppBadge' in navigator) {
      const badgingNavigator = navigator as BadgingNavigator;
      if (safeCount > 0) {
        await badgingNavigator.setAppBadge(safeCount);
      } else {
        await badgingNavigator.clearAppBadge();
      }
    }
  } catch {
    // Badge updates are best-effort
  }
}
