/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import packageJson from './package.json';

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
    minify: isTauriDebug ? false : 'esbuild',
    sourcemap: isTauriDebug,
    emptyOutDir: true,
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        // Matched on resolved paths rather than package names. React 19
        // splits its runtime across subpaths (`react-dom/client`,
        // `react/jsx-runtime`, `scheduler`), which the name-array form does
        // not follow — it left React in two chunks at once, adding ~57 KiB to
        // the initial payload.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          const vendor = (...names: string[]) =>
            names.some((name) => id.includes(`node_modules/${name}/`));

          // Framework runtime shared by every route. Keeping it explicit
          // prevents lazy feature chunks from becoming entry dependencies.
          if (vendor('react', 'react-dom', 'scheduler', 'react-router-dom')) {
            return 'vendor-react';
          }
          // Code editor — heaviest dep, only needed by the system-prompt route
          if (
            vendor(
              '@uiw/react-codemirror',
              '@codemirror/lang-markdown',
              '@codemirror/theme-one-dark',
            )
          ) {
            return 'vendor-editor';
          }
          if (vendor('@hello-pangea/dnd')) return 'vendor-dnd';
          // React Query is required by the application shell, while Axios is
          // first used by lazy routes. Keep HTTP out of the initial preload.
          if (vendor('@tanstack/react-query')) return 'vendor-query';
          if (vendor('axios')) return 'vendor-http';
          return undefined;
        },
      },
    },
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
