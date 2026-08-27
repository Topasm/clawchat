import { platformApi } from '../platform';
import { IS_CAPACITOR, IS_DESKTOP } from '../types/platform';

export interface NotifyOptions {
  /** Silent notification (no sound). Defaults to false. */
  silent?: boolean;
  /** Item type for action buttons (todo or event). */
  itemType?: 'todo' | 'event';
  /** Item ID for action buttons — enables "Mark Done" action. */
  itemId?: string;
}

/**
 * Cross-platform desktop notification with optional action buttons.
 * - Tauri: uses the native notification command
 * - Capacitor: uses LocalNotifications plugin with actionTypeId
 * - Web: uses the browser Notification API
 *
 * When itemType + itemId are provided, a "Mark Done" action button is shown.
 */
export async function notify(
  title: string,
  body: string,
  options: NotifyOptions = {},
): Promise<void> {
  const { silent = false, itemType, itemId } = options;

  if (IS_DESKTOP) {
    await platformApi.notifications.show(title, body, { silent, itemType, itemId });
  } else if (IS_CAPACITOR) {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display === 'prompt') await LocalNotifications.requestPermissions();
    await LocalNotifications.schedule({
      notifications: [
        {
          title,
          body,
          id: Date.now() % 100000,
          schedule: { at: new Date(Date.now() + 100) },
          smallIcon: 'ic_stat_clawchat',
          ...(itemId
            ? {
                actionTypeId: 'REMINDER_ACTIONS',
                extra: { itemType, itemId },
              }
            : {}),
        },
      ],
    });
  } else if (typeof Notification !== 'undefined') {
    if (Notification.permission === 'granted') {
      showWebNotification(title, body, { silent, itemType, itemId });
    } else if (Notification.permission !== 'denied') {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') showWebNotification(title, body, { silent, itemType, itemId });
    }
  }
}

function showWebNotification(
  title: string,
  body: string,
  opts: { silent?: boolean; itemType?: string; itemId?: string },
) {
  const n = new Notification(title, {
    body,
    silent: opts.silent,
    tag: opts.itemId ? `${opts.itemType}-${opts.itemId}` : undefined,
  });
  // Web Notification API doesn't support action buttons in most browsers,
  // but we can navigate on click
  if (opts.itemId && opts.itemType) {
    n.onclick = () => {
      window.focus();
      const route = opts.itemType === 'todo' ? `/tasks/${opts.itemId}` : `/events/${opts.itemId}`;
      window.dispatchEvent(new CustomEvent('navigate', { detail: route }));
    };
  }
}

/**
 * Storage abstraction — uses Capacitor Preferences on mobile,
 * localStorage everywhere else.
 */
export const storage = {
  async get(key: string): Promise<string | null> {
    if (IS_CAPACITOR) {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key });
      return value;
    }
    return localStorage.getItem(key);
  },

  async set(key: string, value: string): Promise<void> {
    if (IS_CAPACITOR) {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key, value });
      return;
    }
    localStorage.setItem(key, value);
  },

  async remove(key: string): Promise<void> {
    if (IS_CAPACITOR) {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.remove({ key });
      return;
    }
    localStorage.removeItem(key);
  },
};

/**
 * Secure storage uses the desktop OS credential vault when available. A legacy
 * local value is promoted on first read; web/mobile and unavailable OS vaults
 * retain the existing storage fallback.
 */
export const secureStorage = {
  async get(key: string): Promise<string | null> {
    if (platformApi.secureStorage) {
      try {
        const secured = await platformApi.secureStorage.get(key);
        if (secured !== null) return secured;
        const legacy = await storage.get(key);
        if (legacy !== null) {
          await platformApi.secureStorage.set(key, legacy);
          await storage.remove(key);
        }
        return legacy;
      } catch (error) {
        console.warn('OS secure storage is unavailable; using platform storage.', error);
      }
    }
    return storage.get(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (platformApi.secureStorage) {
      try {
        await platformApi.secureStorage.set(key, value);
        await storage.remove(key);
        return;
      } catch (error) {
        console.warn('OS secure storage is unavailable; using platform storage.', error);
      }
    }
    return storage.set(key, value);
  },
  async remove(key: string): Promise<void> {
    if (platformApi.secureStorage) {
      try {
        await platformApi.secureStorage.remove(key);
      } catch (error) {
        console.warn('OS secure storage is unavailable while removing a credential.', error);
      }
    }
    return storage.remove(key);
  },
};
