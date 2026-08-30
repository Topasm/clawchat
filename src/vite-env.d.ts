/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __TAURI_DESKTOP_OS__: 'macos' | 'windows' | 'linux';

interface ImportMetaEnv {
  readonly VITE_DEFAULT_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
