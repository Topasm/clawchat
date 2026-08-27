import type {
  AppMode,
  NativeEventChannel,
  NativeServerApi,
  NativeUpdaterApi,
  ServerConfig,
  ServerStatus,
} from '../platform/nativePlatformTypes';

export type { AppMode, ServerConfig, ServerStatus } from '../platform/nativePlatformTypes';

export interface ElectronUpdater extends NativeUpdaterApi {}

export interface ElectronServerAPI extends NativeServerApi {}

export interface ElectronSecureStore {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

export interface ElectronAPI {
  platform: string;
  appVersion: string;
  send: (channel: string, ...args: unknown[]) => void;
  on: (channel: NativeEventChannel, callback: (...args: unknown[]) => void) => () => void;
  showNotification: (title: string, body: string, options?: { silent?: boolean; itemType?: string; itemId?: string }) => void;
  setBadgeCount: (count: number) => void;
  updater: ElectronUpdater;
  server: ElectronServerAPI;
  secureStore?: ElectronSecureStore;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
