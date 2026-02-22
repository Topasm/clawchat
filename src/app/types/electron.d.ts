export interface ElectronAPI {
  platform: string;
  appVersion: string;
  send: (channel: string, ...args: unknown[]) => void;
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  showNotification: (title: string, body: string) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
