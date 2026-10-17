import { expect, test, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:8011';
/** The fixture's "now" (see seed.py): relative dates read the same every run. */
const NOW = new Date('2030-03-12T09:00:00Z');

let token = '';
let refreshToken = '';
let projectId = '';

test.beforeAll(async ({ request }) => {
  const login = await request.post(`${API}/api/auth/login`, { data: { pin: '123456' } });
  expect(login.ok()).toBeTruthy();
  const body = await login.json();
  token = body.access_token;
  refreshToken = body.refresh_token;
  const projects = await request.get(`${API}/api/projects`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const list = await projects.json();
  const items = Array.isArray(list) ? list : (list.items ?? list.projects ?? []);
  projectId = items[0]?.id ?? '';
  expect(projectId).not.toBe('');
});

async function open(page: Page, path: string) {
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
    [{ token, refreshToken }, API] as const,
  );
  // Whether an AI provider is reachable depends on the machine (CI has no
  // CLI, a developer's box may), and it decides whether the Inbox is listed
  // and what the foot of the sidebar says. Pin both so every run draws the
  // same shell.
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
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  // Let lazy chunks, fonts and list animations settle.
  await page.waitForTimeout(800);
}

const screens: Array<{ name: string; path: () => string }> = [
  { name: 'inbox', path: () => '/inbox' },
  { name: 'tasks', path: () => '/tasks' },
  { name: 'task', path: () => '/tasks/todo_visual_slides' },
  // The desktop pane: the same task beside the list it was picked from.
  { name: 'task-pane', path: () => '/tasks?task=todo_visual_slides' },
  { name: 'project', path: () => `/projects/${projectId}` },
  { name: 'attention', path: () => '/attention' },
];

for (const screen of screens) {
  test(screen.name, async ({ page }) => {
    await open(page, screen.path());
    await expect(page).toHaveScreenshot(`${screen.name}.png`);
  });
}
