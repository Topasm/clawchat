import { isTauri } from '@tauri-apps/api/core';
import { createElectronPlatformApi } from './electronPlatformApi';
import { tauriPlatformApi } from './tauriPlatformApi';
import type { NativePlatformApi } from './nativePlatformTypes';
import { webPlatformApi } from './webPlatformApi';

function selectPlatformApi(): NativePlatformApi {
  if (isTauri()) return tauriPlatformApi;
  const electronBridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
  return electronBridge ? createElectronPlatformApi(electronBridge) : webPlatformApi;
}

/**
 * The single renderer-to-native boundary. Feature code must use this adapter
 * instead of importing a desktop runtime or reading a preload global directly.
 */
export const platformApi = selectPlatformApi();

export type {
  AppMode,
  NativeEventChannel,
  NativePlatformApi,
  NativeRuntimeKind,
  NativeSecureStorageApi,
  NativeServerApi,
  NativeUpdaterApi,
  NetworkInfo,
  ServerConfig,
  ServerStatus,
  UpdateDownloadProgress,
  UpdateInfo,
} from './nativePlatformTypes';
