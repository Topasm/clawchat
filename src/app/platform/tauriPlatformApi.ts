import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  AppMode,
  LocalServerTransitionResult,
  LocalSession,
  NativeEventChannel,
  NativeEventPayloadMap,
  NativePlatformApi,
  ServerConfig,
  ServerStatus,
  UpdateDownloadProgress,
  UpdateInfo,
  WorkerRunResult,
  WorkspaceViewMode,
} from './nativePlatformTypes';
import { TAURI_COMMANDS, TAURI_EVENTS } from './tauriCommands';

function subscribe<T>(eventName: string, callback: (payload: T) => void): () => void {
  let active = true;
  const unlistenPromise = listen<T>(eventName, (event) => {
    if (active) callback(event.payload);
  });

  return () => {
    active = false;
    void unlistenPromise.then((unlisten) => unlisten());
  };
}

const eventNames: Record<NativeEventChannel, string> = {
  'open-quick-capture': TAURI_EVENTS.quickCapture,
  'open-settings': TAURI_EVENTS.openSettings,
  'notification:action': TAURI_EVENTS.notificationAction,
  navigate: TAURI_EVENTS.navigate,
};

function subscribeNativeEvent<Channel extends NativeEventChannel>(
  channel: Channel,
  callback: (payload: NativeEventPayloadMap[Channel]) => void,
): () => void {
  return subscribe<NativeEventPayloadMap[Channel]>(eventNames[channel], callback);
}

async function setWorkspaceViewMode(mode: WorkspaceViewMode): Promise<void> {
  await invoke<void>(TAURI_COMMANDS.appSetWorkspaceViewMode, { mode });
}

export const tauriPlatformApi: NativePlatformApi = {
  runtime: {
    kind: 'tauri',
    os: __TAURI_DESKTOP_OS__,
    appVersion: __APP_VERSION__,
    isDesktop: true,
  },
  events: {
    on: subscribeNativeEvent,
  },
  notifications: {
    show: (title, body, options) =>
      invoke<void>(TAURI_COMMANDS.appShowNotification, { title, body, options }),
    setBadgeCount: (count) => invoke<void>(TAURI_COMMANDS.appSetBadgeCount, { count }),
  },
  updater: {
    checkForUpdates: () => invoke<UpdateInfo | null>(TAURI_COMMANDS.updaterCheck),
    downloadUpdate: () => invoke<void>(TAURI_COMMANDS.updaterDownload),
    installUpdate: () => invoke<void>(TAURI_COMMANDS.updaterInstall),
    onUpdateAvailable: (callback) => subscribe<UpdateInfo>(TAURI_EVENTS.updateAvailable, callback),
    onUpdateNotAvailable: (callback) => subscribe<void>(TAURI_EVENTS.updateNotAvailable, callback),
    onDownloadProgress: (callback) =>
      subscribe<UpdateDownloadProgress>(TAURI_EVENTS.updateDownloadProgress, callback),
    onUpdateDownloaded: (callback) => subscribe<void>(TAURI_EVENTS.updateDownloaded, callback),
  },
  worker: {
    run: (request) => invoke<WorkerRunResult>(TAURI_COMMANDS.workerRun, { request }),
  },
  server: {
    getStatus: () => invoke<ServerStatus>(TAURI_COMMANDS.serverGetStatus),
    getConfig: () => invoke<ServerConfig>(TAURI_COMMANDS.serverGetConfig),
    issueLocalSession: () => invoke<LocalSession>(TAURI_COMMANDS.serverIssueLocalSession),
    getNetworkInfo: () => invoke(TAURI_COMMANDS.serverGetNetworkInfo),
    updateConfig: (updates) =>
      invoke<LocalServerTransitionResult>(TAURI_COMMANDS.serverUpdateConfig, { updates }),
    selectFolder: () => invoke<string | null>(TAURI_COMMANDS.serverSelectFolder),
    openObsidianVault: () => invoke<void>(TAURI_COMMANDS.serverOpenObsidianVault),
    openLogFolder: () => invoke<void>(TAURI_COMMANDS.serverOpenLogFolder),
    openDataFolder: () => invoke<void>(TAURI_COMMANDS.serverOpenDataFolder),
    setAppMode: (mode: AppMode) =>
      invoke<LocalServerTransitionResult>(TAURI_COMMANDS.serverSetAppMode, { mode }),
    getAppMode: () => invoke<AppMode>(TAURI_COMMANDS.serverGetAppMode),
    onStatusChange: (callback) =>
      subscribe<ServerStatus>(TAURI_EVENTS.serverStatusChange, callback),
    onRuntimeChange: (callback) =>
      subscribe<LocalServerTransitionResult>(TAURI_EVENTS.workspaceRuntimeChange, callback),
  },
  system: {
    openCameraSettings: () => invoke<void>(TAURI_COMMANDS.appOpenCameraSettings),
  },
  appWindow: {
    setWorkspaceViewMode,
  },
  secureStorage: {
    get: (key) => invoke<string | null>(TAURI_COMMANDS.secureStorageGet, { key }),
    set: (key, value) => invoke<void>(TAURI_COMMANDS.secureStorageSet, { key, value }),
    remove: (key) => invoke<void>(TAURI_COMMANDS.secureStorageRemove, { key }),
  },
};
