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

  return { plugins };
});
