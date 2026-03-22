import { IS_CAPACITOR, IS_ELECTRON } from '../types/platform';

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
 * - Electron: uses native Notification via IPC
 * - Capacitor: uses LocalNotifications plugin with actionTypeId
 * - Web: uses the browser Notification API
 *
 * When itemType + itemId are provided, a "Mark Done" action button is shown.
 */
export async function notify(title: string, body: string, options: NotifyOptions = {}): Promise<void> {
  const { silent = false, itemType, itemId } = options;

  if (IS_ELECTRON) {
    window.electronAPI?.showNotification(title, body, { silent, itemType, itemId });
  } else if (IS_CAPACITOR) {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display === 'prompt') await LocalNotifications.requestPermissions();
    await LocalNotifications.schedule({
      notifications: [{
        title,
        body,
        id: Date.now() % 100000,
        schedule: { at: new Date(Date.now() + 100) },
        smallIcon: 'ic_stat_clawchat',
        ...(itemId ? {
          actionTypeId: 'REMINDER_ACTIONS',
          extra: { itemType, itemId },
        } : {}),
      }],
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
 * Secure storage — uses Electron's safeStorage (OS-level encryption) when
 * running in Electron, falls back to the regular storage abstraction otherwise.
 */
export const secureStorage = {
  async get(key: string): Promise<string | null> {
    const api = (window as any).electronAPI;
    if (api?.secureStore) {
      return api.secureStore.get(key);
    }
    return storage.get(key);
  },
  async set(key: string, value: string): Promise<void> {
    const api = (window as any).electronAPI;
    if (api?.secureStore) {
      return api.secureStore.set(key, value);
    }
    return storage.set(key, value);
  },
  async remove(key: string): Promise<void> {
    const api = (window as any).electronAPI;
    if (api?.secureStore) {
      return api.secureStore.delete(key);
    }
    return storage.remove(key);
  },
};
