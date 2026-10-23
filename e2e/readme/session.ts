import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** The fixture's "now" (see e2e/visual/seed.py): relative dates read the same every run. */
export const NOW = new Date('2030-03-12T09:00:00Z');

export type Session = { token: string; refreshToken: string; api: string };

export async function login(request: APIRequestContext, api: string): Promise<Session> {
  const login = await request.post(`${api}/api/auth/login`, { data: { pin: '123456' } });
  expect(login.ok()).toBeTruthy();
  const body = await login.json();
  return { token: body.access_token, refreshToken: body.refresh_token, api };
}

export async function firstProjectId(request: APIRequestContext, session: Session): Promise<string> {
  const projects = await request.get(`${session.api}/api/projects`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  const list = await projects.json();
  const items = Array.isArray(list) ? list : (list.items ?? list.projects ?? []);
  const id = items[0]?.id ?? '';
  expect(id).not.toBe('');
  return id;
}

/**
 * Signs the page in, pins its clock to the fixture morning and makes the AI
 * read as connected (the same shell the visual screenshots draw), then opens
 * the path and lets fonts, lazy chunks and list animations settle.
 */
export async function open(page: Page, session: Session, path: string) {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(
    ([auth, api]) => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: {
            token: auth.token,
            refreshToken: auth.refreshToken,
            serverUrl: api,
            hostId: null,
            hostPublicKey: null,
            relayUrl: null,
          },
          version: 0,
        }),
      );
      localStorage.setItem('clawchat-language', 'en');
    },
    [{ token: session.token, refreshToken: session.refreshToken }, session.api] as const,
  );
  await page.route('**/api/capabilities', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.ai = { ...body.ai, available: true, model: 'claude sonnet (via CLI)' };
    body.features = { ...body.features, inbox_pipeline: true, agent_tasks: true };
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/health', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, ai_connected: true, ai_model: 'claude sonnet (via CLI)' },
    });
  });
  // The runs view also lists the CLI sessions found on the machine that
  // renders these images; the README should show the fixture, not them.
  await page.route('**/api/cli-sessions', async (route) => {
    await route.fulfill({ json: { sessions: [], providers: [] } });
  });
  // Today is decided by the server from its own clock unless the request
  // names a date; name the fixture's.
  await page.route(/\/api\/today$/, async (route) => {
    const day = NOW.toISOString().slice(0, 10);
    await route.continue({ url: `${route.request().url()}?date=${day}&utc_offset_minutes=0` });
  });
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
}

export async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
}
