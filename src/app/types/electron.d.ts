export type AppMode = 'client' | 'host';

export interface ElectronUpdater {
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  onUpdateAvailable: (cb: (info: { version: string; releaseNotes?: string }) => void) => () => void;
  onUpdateDownloaded: (cb: () => void) => () => void;
}

export interface ServerStatus {
  state: 'starting' | 'running' | 'stopped' | 'error';
  port: number;
  pid?: number;
  error?: string;
}

export interface ServerConfig {
  appMode: AppMode;
  port: number;
  pin: string;
  obsidianVaultPath: string;
  hostServerUrl: string;
  autoStartHost: boolean;
}

export interface ElectronServerAPI {
  getStatus: () => Promise<ServerStatus>;
  getConfig: () => Promise<ServerConfig>;
  getNetworkInfo: () => Promise<{ addresses: { ip: string; name: string; networkType?: string }[] }>;
  updateConfig: (updates: Partial<ServerConfig>) => Promise<ServerConfig>;
  selectFolder: () => Promise<string | null>;
  openObsidianVault: () => Promise<void>;
  setAppMode: (mode: AppMode) => Promise<ServerConfig>;
  getAppMode: () => Promise<AppMode>;
  onStatusChange: (cb: (status: ServerStatus) => void) => () => void;
}

export interface ElectronAPI {
  platform: string;
  appVersion: string;
  send: (channel: string, ...args: unknown[]) => void;
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  showNotification: (title: string, body: string, options?: { silent?: boolean; itemType?: string; itemId?: string }) => void;
  setBadgeCount: (count: number) => void;
  updater: ElectronUpdater;
  server: ElectronServerAPI;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
