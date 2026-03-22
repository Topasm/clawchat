import { contextBridge, ipcRenderer } from 'electron';

export interface ServerStatus {
  state: 'starting' | 'running' | 'stopped' | 'error';
  port: number;
  pid?: number;
  error?: string;
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  appVersion: process.env.npm_package_version ?? '0.1.0',
  send: (channel: string, ...args: unknown[]) => {
    ipcRenderer.send(channel, ...args);
  },
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      callback(...args);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
  showNotification: (title: string, body: string) => {
    ipcRenderer.send('notification:show', title, body);
  },
  secureStore: {
    get: (key: string) => ipcRenderer.invoke('secure-store:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('secure-store:set', key, value),
    delete: (key: string) => ipcRenderer.invoke('secure-store:delete', key),
  },
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('update:check'),
    downloadUpdate: () => ipcRenderer.invoke('update:download'),
    installUpdate: () => ipcRenderer.invoke('update:install'),
    onUpdateAvailable: (cb: (info: { version: string; releaseNotes?: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, info: { version: string; releaseNotes?: string }) => cb(info);
      ipcRenderer.on('update-available', listener);
      return () => ipcRenderer.removeListener('update-available', listener);
    },
    onUpdateDownloaded: (cb: () => void) => {
      const listener = () => cb();
      ipcRenderer.on('update-downloaded', listener);
      return () => ipcRenderer.removeListener('update-downloaded', listener);
    },
  },
  server: {
    getStatus: (): Promise<ServerStatus> => ipcRenderer.invoke('server:status'),
    restart: (): Promise<ServerStatus> => ipcRenderer.invoke('server:restart'),
    getConfig: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('server:config'),
    getNetworkInfo: (): Promise<{ addresses: { ip: string; name: string; networkType?: string }[] }> =>
      ipcRenderer.invoke('server:network-info'),
    updateConfig: (updates: Record<string, unknown>): Promise<Record<string, unknown>> =>
      ipcRenderer.invoke('server:update-config', updates),
    selectFolder: (): Promise<string | null> => ipcRenderer.invoke('server:select-folder'),
    openObsidianVault: () => ipcRenderer.invoke('obsidian:open-vault'),
    onStatusChange: (cb: (status: ServerStatus) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: ServerStatus) => cb(status);
      ipcRenderer.on('server:status-changed', listener);
      return () => ipcRenderer.removeListener('server:status-changed', listener);
    },
  },
});
