import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';
import visual from '../visual/playwright.config';

type WebServer = Exclude<NonNullable<PlaywrightTestConfig['webServer']>, unknown[]>;

/**
 * README media: the screens and the walkthrough frames the README shows,
 * rendered from a seeded backend (the visual fixture plus events, a review
 * and a chat thread) and the built renderer. Nothing here is compared with a
 * baseline; the output is committed under docs/media/. Run `npm run
 * readme:media`.
 */
const BACKEND_PORT = 8012;
const WEB_PORT = 4175;
const DB = 'e2e/readme/.data/readme.db';
const [api, web] = visual.webServer as WebServer[];

export default defineConfig({
  ...visual,
  testDir: '.',
  outputDir: 'test-results',
  snapshotPathTemplate: undefined,
  use: { ...visual.use, baseURL: `http://localhost:${WEB_PORT}` },
  projects: [
    { name: 'light', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'light' } },
    { name: 'dark', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } },
    // Run on its own (see `readme:media:shots`): the capture adds a row the
    // stills must not show, and each invocation starts from a fresh seed.
    { name: 'walkthrough', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'light' } },
  ],
  webServer: [
    {
      ...api,
      command:
        `rm -f ${DB} && mkdir -p e2e/readme/.data && ` +
        `uv run --project server --locked python e2e/readme/seed.py && ` +
        `uv run --project server --locked uvicorn main:app --app-dir server --host 127.0.0.1 --port ${BACKEND_PORT}`,
      url: `http://127.0.0.1:${BACKEND_PORT}/api/health`,
      env: {
        ...api.env,
        DATABASE_URL: `sqlite+aiosqlite:///./${DB}`,
        PORT: String(BACKEND_PORT),
        CORS_ALLOW_ORIGINS: `http://localhost:${WEB_PORT}`,
      },
    },
    {
      ...web,
      command: `npx vite preview --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
    },
  ],
});

export { BACKEND_PORT, WEB_PORT };
