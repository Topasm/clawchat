/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import packageJson from './package.json';

const tauriPlatform = process.env.TAURI_ENV_PLATFORM;
const isTauriDebug = process.env.TAURI_ENV_DEBUG === 'true';
const packageVersion = packageJson.version;

const browserTarget = tauriPlatform
  ? tauriPlatform === 'windows'
    ? 'chrome105'
    : 'safari13'
  : 'es2022';

export default defineConfig({
  plugins: [react()],
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
          // React Query is required by the application shell, while Axios is
          // first used by lazy routes. Keep HTTP out of the initial preload.
          'vendor-query': ['@tanstack/react-query'],
          'vendor-http': ['axios'],
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
