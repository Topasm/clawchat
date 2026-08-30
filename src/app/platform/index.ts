import { isTauri } from '@tauri-apps/api/core';
import { tauriPlatformApi } from './tauriPlatformApi';
import type { NativePlatformApi } from './nativePlatformTypes';
import { webPlatformApi } from './webPlatformApi';

function selectPlatformApi(): NativePlatformApi {
  return isTauri() ? tauriPlatformApi : webPlatformApi;
}

/**
 * The single renderer-to-native boundary. Feature code must use this adapter
 * instead of importing Tauri APIs directly.
 */
export const platformApi = selectPlatformApi();

export type {
  AppMode,
  DesktopOS,
  LocalServerTransitionResult,
  LocalSession,
  NativeEventChannel,
  NativeEventPayloadMap,
  NativeNotificationAction,
  NativePlatformApi,
  NativeOS,
  NativeRuntimeKind,
  NativeSecureStorageApi,
  NativeServerApi,
  NativeUpdaterApi,
  NetworkInfo,
  ServerConfig,
  ServerConfigUpdate,
  ServerStatus,
  UpdateDownloadProgress,
  UpdateInfo,
} from './nativePlatformTypes';
