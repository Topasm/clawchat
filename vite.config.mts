/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import packageJson from './package.json' with { type: 'json' };

const tauriPlatform = process.env.TAURI_ENV_PLATFORM;
const isTauriDebug = process.env.TAURI_ENV_DEBUG === 'true';
const packageVersion = packageJson.version;
const tauriDesktopOs =
  tauriPlatform === 'darwin' || tauriPlatform === 'macos'
    ? 'macos'
    : tauriPlatform === 'windows'
      ? 'windows'
      : tauriPlatform === 'linux'
        ? 'linux'
        : process.platform === 'win32'
          ? 'windows'
          : process.platform === 'darwin'
            ? 'macos'
            : 'linux';

const browserTarget = tauriPlatform
  ? tauriPlatform === 'windows'
    ? 'chrome105'
    : 'safari13'
  : 'es2022';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
    __TAURI_DESKTOP_OS__: JSON.stringify(tauriDesktopOs),
  },
  build: {
    target: browserTarget,
    minify: !isTauriDebug,
    sourcemap: isTauriDebug,
    emptyOutDir: true,
    chunkSizeWarningLimit: 650,
    // Let Rolldown split on actual imports. Rollup's old vendor groups
    // pulled lazy editor and drag-and-drop dependencies into the entry.
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/server/**', '**/src-tauri/**'],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/__tests__/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
  },
});
