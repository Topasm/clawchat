export type AppMode = 'client' | 'host';

export type NativeRuntimeKind = 'web' | 'electron' | 'tauri';

export type NativeEventChannel =
  | 'open-quick-capture'
  | 'notification:action'
  | 'navigate';

export interface UpdateInfo {
  version: string;
  releaseNotes?: string;
}

export interface UpdateDownloadProgress {
  downloadedBytes: number;
  totalBytes?: number;
  percent?: number;
}

export interface NativeUpdaterApi {
  checkForUpdates: () => Promise<UpdateInfo | null>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
  onUpdateNotAvailable: (callback: () => void) => () => void;
  onDownloadProgress: (callback: (progress: UpdateDownloadProgress) => void) => () => void;
  onUpdateDownloaded: (callback: () => void) => () => void;
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

export interface NetworkInfo {
  addresses: Array<{
    ip: string;
    name: string;
    networkType?: string;
  }>;
}

export interface NativeServerApi {
  getStatus: () => Promise<ServerStatus>;
  getConfig: () => Promise<ServerConfig>;
  getNetworkInfo: () => Promise<NetworkInfo>;
  updateConfig: (updates: Partial<ServerConfig>) => Promise<ServerConfig>;
  selectFolder: () => Promise<string | null>;
  openObsidianVault: () => Promise<void>;
  setAppMode: (mode: AppMode) => Promise<ServerConfig>;
  getAppMode: () => Promise<AppMode>;
  onStatusChange: (callback: (status: ServerStatus) => void) => () => void;
}

export interface NativeSecureStorageApi {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

export interface NativePlatformApi {
  runtime: {
    kind: NativeRuntimeKind;
    os: string;
    appVersion: string;
    isDesktop: boolean;
  };
  events: {
    on: (channel: NativeEventChannel, callback: (...args: unknown[]) => void) => () => void;
  };
  notifications: {
    show: (
      title: string,
      body: string,
      options?: { silent?: boolean; itemType?: string; itemId?: string },
    ) => Promise<void>;
    setBadgeCount: (count: number) => Promise<void>;
  };
  updater: NativeUpdaterApi;
  server: NativeServerApi;
  secureStorage: NativeSecureStorageApi | null;
}
