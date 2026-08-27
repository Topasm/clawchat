import type { ElectronAPI } from '../types/electron';
import type { NativePlatformApi } from './nativePlatformTypes';

export function createElectronPlatformApi(bridge: ElectronAPI): NativePlatformApi {
  return {
    runtime: {
      kind: 'electron',
      os: bridge.platform,
      appVersion: bridge.appVersion,
      isDesktop: true,
    },
    events: {
      on: (channel, callback) => bridge.on(channel, callback),
    },
    notifications: {
      show: async (title, body, options) => {
        bridge.showNotification(title, body, options);
      },
      setBadgeCount: async (count) => {
        bridge.setBadgeCount(count);
      },
    },
    updater: bridge.updater,
    server: bridge.server,
    secureStorage: bridge.secureStore
      ? {
          get: (key) => bridge.secureStore!.get(key),
          set: (key, value) => bridge.secureStore!.set(key, value),
          remove: (key) => bridge.secureStore!.delete(key),
        }
      : null,
  };
}
