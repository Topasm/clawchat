export interface ElectronUpdater {
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  onUpdateAvailable: (cb: (info: { version: string; releaseNotes?: string }) => void) => () => void;
  onUpdateDownloaded: (cb: () => void) => () => void;
}

export interface ElectronServerAPI {
  getStatus: () => Promise<string>;
  getConfig: () => Promise<{ port: number; pin: string; obsidianVaultPath: string }>;
  getNetworkInfo: () => Promise<{ addresses: { ip: string; name: string; networkType?: string }[] }>;
  updateConfig: (updates: Record<string, unknown>) => Promise<void>;
  selectFolder: () => Promise<string | null>;
  openObsidianVault: () => Promise<void>;
  onStatusChange: (cb: (status: string) => void) => () => void;
}

export interface ElectronAPI {
  platform: string;
  appVersion: string;
  send: (channel: string, ...args: unknown[]) => void;
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  showNotification: (title: string, body: string) => void;
  updater: ElectronUpdater;
  server: ElectronServerAPI;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
