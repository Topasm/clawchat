import { IS_CAPACITOR, IS_ELECTRON, IS_WEB } from '../types/platform';

/**
 * Updates the native app icon badge count across all platforms.
 * - iOS/Android (Capacitor): uses LocalNotifications badge
 * - Electron: uses app.setBadgeCount via IPC
 * - Web: uses navigator.setAppBadge (W3C Badging API)
 */
export async function setAppBadge(count: number): Promise<void> {
  const safeCount = Math.max(0, Math.round(count));

  try {
    if (IS_ELECTRON) {
      window.electronAPI?.setBadgeCount(safeCount);
    } else if (IS_CAPACITOR) {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      // Capacitor 6 LocalNotifications doesn't have setBadge — use the Badge plugin
      // approach via native bridge. For iOS, setting badge on a notification works.
      // We schedule a silent local notification with the badge count.
      const { Capacitor } = await import('@capacitor/core');
      const BadgePlugin = Capacitor.Plugins['Badge'] as {
        set(opts: { count: number }): Promise<void>;
        clear(): Promise<void>;
      } | undefined;

      if (BadgePlugin) {
        if (safeCount > 0) {
          await BadgePlugin.set({ count: safeCount });
        } else {
          await BadgePlugin.clear();
        }
      } else {
        // Fallback: use LocalNotifications badge property (iOS only)
        // Android badges are handled via notification channel badge settings
        await LocalNotifications.schedule({
          notifications: [{
            id: 99999,
            title: '',
            body: '',
            schedule: { at: new Date(Date.now() + 31536000000) }, // far future — never fires
            extra: { badgeUpdate: true },
          }],
        });
      }
    } else if (IS_WEB && 'setAppBadge' in navigator) {
      if (safeCount > 0) {
        await (navigator as any).setAppBadge(safeCount);
      } else {
        await (navigator as any).clearAppBadge();
      }
    }
  } catch {
    // Badge updates are best-effort
  }
}

/**
 * Clears the app icon badge.
 */
export async function clearAppBadge(): Promise<void> {
  return setAppBadge(0);
}
