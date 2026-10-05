import { defineConfig, devices } from '@playwright/test';

/**
 * Web screenshots: a seeded backend and the built renderer, compared with
 * the baselines in ./__screenshots__. Run `npm run test:visual`; refresh the
 * baselines with `npm run test:visual -- --update-snapshots` or the
 * "Record web screenshots" workflow.
 */
const BACKEND_PORT = 8011;
const WEB_PORT = 4174;
const DB = 'e2e/visual/.data/visual.db';

export default defineConfig({
  testDir: '.',
  // Not a dot folder: upload-artifact skips hidden paths, and the diffs live here.
  outputDir: 'test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{projectName}{ext}',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002 },
  },
  projects: [
    { name: 'light', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'light' } },
    { name: 'dark', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } },
  ],
  webServer: [
    {
      // Fresh database, fixed fixture, then the API.
      command:
        `rm -f ${DB} && mkdir -p e2e/visual/.data && ` +
        `uv run --project server --locked python e2e/visual/seed.py && ` +
        `uv run --project server --locked uvicorn main:app --app-dir server --host 127.0.0.1 --port ${BACKEND_PORT}`,
      cwd: '../..',
      url: `http://127.0.0.1:${BACKEND_PORT}/api/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: `sqlite+aiosqlite:///./${DB}`,
        PIN: '123456',
        JWT_SECRET: 'visual-screenshots-not-a-secret',
        AI_PROVIDER: 'ollama',
        AI_BASE_URL: 'http://127.0.0.1:9',
        ENABLE_SCHEDULER: 'false',
        PORT: String(BACKEND_PORT),
        CORS_ALLOW_ORIGINS: `http://localhost:${WEB_PORT}`,
      },
    },
    {
      // The production build, served as-is (`npm run build:web` first).
      command: `npx vite preview --port ${WEB_PORT} --strictPort`,
      cwd: '../..',
      url: `http://localhost:${WEB_PORT}`,
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
