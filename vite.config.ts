/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import packageJson from './package.json';

const isElectron = process.env.BUILD_TARGET === 'electron';
const tauriPlatform = process.env.TAURI_ENV_PLATFORM;
const isTauriDebug = process.env.TAURI_ENV_DEBUG === 'true';
const packageVersion = packageJson.version;

const browserTarget = tauriPlatform
  ? tauriPlatform === 'windows'
    ? 'chrome105'
    : 'safari13'
  : 'es2022';

export default defineConfig(async () => {
  const plugins = [react()];

  if (isElectron) {
    const electron = (await import('vite-plugin-electron')).default;
    const renderer = (await import('vite-plugin-electron-renderer')).default;

    plugins.push(
      electron([
        {
          entry: 'electron/main.ts',
          vite: {
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                external: ['electron'],
              },
            },
          },
        },
        {
          entry: 'electron/preload.ts',
          onstart({ reload }) {
            reload();
          },
          vite: {
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                external: ['electron'],
              },
            },
          },
        },
      ]),
      renderer(),
    );
  }

  return {
    plugins,
    define: {
      __APP_VERSION__: JSON.stringify(packageVersion),
    },
    build: {
      target: browserTarget,
      minify: isTauriDebug ? false : 'esbuild',
      sourcemap: isTauriDebug,
      emptyOutDir: true,
      chunkSizeWarningLimit: 650,
      rollupOptions: {
        output: {
          manualChunks: {
            // Framework runtime shared by every route. Keeping it explicit prevents
            // lazy feature chunks from becoming accidental entry dependencies.
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            // Rich-text / code editor — heaviest deps, rarely needed on first load
            'vendor-editor': [
              'lexical',
              '@lexical/rich-text',
              '@lexical/list',
              '@lexical/link',
              '@lexical/code',
              '@lexical/markdown',
              '@lexical/utils',
              '@uiw/react-codemirror',
              '@codemirror/lang-markdown',
              '@codemirror/theme-one-dark',
            ],
            // Drag-and-drop
            'vendor-dnd': ['@hello-pangea/dnd'],
            // Data fetching / API layer
            'vendor-query': ['@tanstack/react-query', 'axios'],
            // Virtual scrolling
            'vendor-virtuoso': ['react-virtuoso'],
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
  };
});
