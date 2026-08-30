import type { NativePlatformApi } from './nativePlatformTypes';

function unavailable(operation: string): Promise<never> {
  return Promise.reject(new Error(`${operation} is unavailable in the web runtime`));
}

export const webPlatformApi: NativePlatformApi = {
  runtime: {
    kind: 'web',
    os: 'web',
    appVersion: __APP_VERSION__,
    isDesktop: false,
  },
  events: {
    on: () => () => {},
  },
  notifications: {
    show: async () => {},
    setBadgeCount: async () => {},
  },
  updater: {
    checkForUpdates: () => unavailable('Updater'),
    downloadUpdate: () => unavailable('Updater'),
    installUpdate: () => unavailable('Updater'),
    onUpdateAvailable: () => () => {},
    onUpdateNotAvailable: () => () => {},
    onDownloadProgress: () => () => {},
    onUpdateDownloaded: () => () => {},
  },
  server: {
    getStatus: () => unavailable('Native server'),
    getConfig: () => unavailable('Native server'),
    issueLocalSession: () => unavailable('Native local session'),
    getNetworkInfo: () => unavailable('Native server'),
    updateConfig: () => unavailable('Native server'),
    selectFolder: () => unavailable('Folder picker'),
    openObsidianVault: () => unavailable('Obsidian launcher'),
    openLogFolder: () => unavailable('Native log folder'),
    openDataFolder: () => unavailable('Native data folder'),
    setAppMode: () => unavailable('App mode'),
    getAppMode: () => unavailable('App mode'),
    onStatusChange: () => () => {},
    onRuntimeChange: () => () => {},
  },
  system: {
    openCameraSettings: () => unavailable('Camera settings'),
  },
  appWindow: {
    setWorkspaceViewMode: async () => {},
  },
  secureStorage: null,
};
