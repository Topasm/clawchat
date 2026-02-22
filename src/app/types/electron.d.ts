export interface ElectronUpdater {
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  onUpdateAvailable: (cb: (info: { version: string; releaseNotes?: string }) => void) => () => void;
  onUpdateDownloaded: (cb: () => void) => () => void;
}

export interface ElectronAPI {
  platform: string;
  appVersion: string;
  send: (channel: string, ...args: unknown[]) => void;
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  showNotification: (title: string, body: string) => void;
  updater: ElectronUpdater;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
