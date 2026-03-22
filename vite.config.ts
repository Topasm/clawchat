/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isElectron = process.env.BUILD_TARGET === 'electron';

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
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
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
            // QR, animation, dialog — used in pairing / modals
            'vendor-ui-extras': [
              'qrcode.react',
              'framer-motion',
              '@radix-ui/react-dialog',
              'cmdk',
            ],
            // Virtual scrolling
            'vendor-virtuoso': ['react-virtuoso'],
          },
        },
      },
    },
    server: {
      watch: {
        ignored: ['**/server/**'],
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
