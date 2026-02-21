import { IS_CAPACITOR } from '../types/platform';

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
