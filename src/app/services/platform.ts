import { IS_CAPACITOR, IS_ELECTRON } from '../types/platform';

/**
 * Cross-platform desktop notification.
 * - Electron: uses native Notification via IPC
 * - Capacitor: uses LocalNotifications plugin
 * - Web: uses the browser Notification API
 */
export async function notify(title: string, body: string): Promise<void> {
  if (IS_ELECTRON) {
    window.electronAPI?.showNotification(title, body);
  } else if (IS_CAPACITOR) {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display === 'prompt') await LocalNotifications.requestPermissions();
    await LocalNotifications.schedule({
      notifications: [{
        title,
        body,
        id: Date.now(),
        schedule: { at: new Date(Date.now() + 100) },
        smallIcon: 'ic_stat_clawchat',
      }],
    });
  } else if (typeof Notification !== 'undefined') {
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if (Notification.permission !== 'denied') {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') new Notification(title, { body });
    }
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
