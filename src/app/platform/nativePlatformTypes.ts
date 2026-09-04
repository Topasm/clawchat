export type AppMode = 'client' | 'host';

export type NativeRuntimeKind = 'web' | 'tauri';
export type DesktopOS = 'macos' | 'windows' | 'linux';
export type NativeOS = DesktopOS | 'web';
export type WorkspaceViewMode = 'simple' | 'expanded';

export interface NativeNotificationAction {
  action?: string;
  itemType?: string;
  itemId?: string;
}

export interface NativeEventPayloadMap {
  'open-quick-capture': void;
  'open-settings': void;
  'notification:action': NativeNotificationAction;
  navigate: string;
}

export type NativeEventChannel = keyof NativeEventPayloadMap;

export interface UpdateInfo {
  version: string;
  releaseNotes?: string;
}

export interface UpdateDownloadProgress {
  downloadedBytes: number;
  totalBytes?: number;
  percent?: number;
}

export interface WorkerRunRequest {
  /** "claude" or "codex". */
  provider: string;
  prompt: string;
  /** Directory the CLI runs in, as the server recorded it for this machine. */
  cwd: string;
  model?: string | null;
}

export interface WorkerRunResult {
  output: string;
  error?: string | null;
}

/** One README-like file read from a bound folder on this machine. */
export interface WorkspaceContextFile {
  /** Relative to the bound directory. */
  path: string;
  text: string;
}

export interface NativeWorkerApi {
  /** Runs an agent CLI here, in the project's directory on this machine. */
  run: (request: WorkerRunRequest) => Promise<WorkerRunResult>;
  /** What a bound folder says about itself, bounded and without following links. */
  readContext: (path: string) => Promise<WorkspaceContextFile[]>;
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
  localServerEnabled: boolean;
  keepRunningInTray: boolean;
  port: number;
  pinConfigured: boolean;
  defaultPinInUse: boolean;
  obsidianVaultPath: string;
  hostServerUrl: string;
  autoStartHost: boolean;
  lanAccess: boolean;
}

export type ServerConfigUpdate = Partial<
  Omit<ServerConfig, 'pinConfigured' | 'defaultPinInUse'>
> & {
  /** One-way update. The current PIN is never returned to the renderer. */
  pin?: string;
};

export interface LocalServerTransitionResult {
  config: ServerConfig;
  previousStatus: ServerStatus;
  status: ServerStatus;
  applied: boolean;
  restartRequired: boolean;
}

export interface LocalSession {
  access_token: string;
  refresh_token?: string | null;
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
  issueLocalSession: () => Promise<LocalSession>;
  getNetworkInfo: () => Promise<NetworkInfo>;
  updateConfig: (updates: ServerConfigUpdate) => Promise<LocalServerTransitionResult>;
  selectFolder: () => Promise<string | null>;
  openObsidianVault: () => Promise<void>;
  openLogFolder: () => Promise<void>;
  openDataFolder: () => Promise<void>;
  setAppMode: (mode: AppMode) => Promise<LocalServerTransitionResult>;
  getAppMode: () => Promise<AppMode>;
  onStatusChange: (callback: (status: ServerStatus) => void) => () => void;
  onRuntimeChange: (callback: (runtime: LocalServerTransitionResult) => void) => () => void;
}

export interface NativeSecureStorageApi {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

export interface NativeSystemApi {
  /**
   * Open the OS pane where camera access is granted. Rejects when the platform
   * exposes no such pane (most Linux desktops) so callers can fall back to
   * on-screen instructions.
   */
  openCameraSettings: () => Promise<void>;
  /** Open a validated Markdown path or obsidian:// document target. */
  openCanonicalDocument: (target: string) => Promise<void>;
}

export interface NativeAppWindowApi {
  setWorkspaceViewMode: (mode: WorkspaceViewMode) => Promise<void>;
}

export interface NativePlatformApi {
  runtime: {
    kind: NativeRuntimeKind;
    os: NativeOS;
    appVersion: string;
    isDesktop: boolean;
  };
  events: {
    on: <Channel extends NativeEventChannel>(
      channel: Channel,
      callback: (payload: NativeEventPayloadMap[Channel]) => void,
    ) => () => void;
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
  /** Runs work this machine was addressed for. Null where there is no shell. */
  worker: NativeWorkerApi | null;
  server: NativeServerApi;
  system: NativeSystemApi;
  appWindow: NativeAppWindowApi;
  secureStorage: NativeSecureStorageApi | null;
}
