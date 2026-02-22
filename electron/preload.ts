import { contextBridge, ipcRenderer } from 'electron';

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
});
