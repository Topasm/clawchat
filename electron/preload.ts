import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  appVersion: '0.1.0',

  send(channel: string, ...args: unknown[]) {
    const allowed = ['show-notification', 'set-badge-count'];
    if (allowed.includes(channel)) ipcRenderer.send(channel, ...args);
  },

  on(channel: string, callback: (...args: unknown[]) => void) {
    const allowed = ['update-available', 'update-downloaded', 'open-quick-capture', 'notification:action', 'navigate'];
    if (!allowed.includes(channel)) return () => {};

    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  showNotification(title: string, body: string, options?: { silent?: boolean }) {
    ipcRenderer.send('show-notification', title, body, options);
  },

  setBadgeCount(count: number) {
    ipcRenderer.send('set-badge-count', count);
  },

  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater:check'),
    downloadUpdate: () => ipcRenderer.invoke('updater:download'),
    installUpdate: () => ipcRenderer.invoke('updater:install'),
    onUpdateAvailable(cb: (info: { version: string; releaseNotes?: string }) => void) {
      const listener = (_event: Electron.IpcRendererEvent, info: { version: string; releaseNotes?: string }) => cb(info);
      ipcRenderer.on('update-available', listener);
      return () => ipcRenderer.removeListener('update-available', listener);
    },
    onUpdateDownloaded(cb: () => void) {
      const listener = () => cb();
      ipcRenderer.on('update-downloaded', listener);
      return () => ipcRenderer.removeListener('update-downloaded', listener);
    },
  },

  server: {
    getStatus: () => ipcRenderer.invoke('server:getStatus'),
    getConfig: () => ipcRenderer.invoke('server:getConfig'),
    getNetworkInfo: () => ipcRenderer.invoke('server:getNetworkInfo'),
    updateConfig: (updates: Record<string, unknown>) => ipcRenderer.invoke('server:updateConfig', updates),
    selectFolder: () => ipcRenderer.invoke('server:selectFolder'),
    openObsidianVault: () => ipcRenderer.invoke('server:openObsidianVault'),
    onStatusChange(cb: (status: { state: string; port: number; pid?: number; error?: string }) => void) {
      const listener = (_event: Electron.IpcRendererEvent, status: { state: string; port: number }) => cb(status);
      ipcRenderer.on('server-status-change', listener);
      return () => ipcRenderer.removeListener('server-status-change', listener);
    },
  },
});
