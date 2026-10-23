import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { Story } from './frames';
import { NOW, firstProjectId, login, open, settle, type Session } from './session';
import { BACKEND_PORT } from './playwright.config';

const API = `http://127.0.0.1:${BACKEND_PORT}`;
const MEDIA = path.resolve(__dirname, '../../docs/media');
const CONVERSATION = 'conv_readme_hotels';

let session: Session;
let projectId = '';

test.beforeAll(async ({ request }) => {
  session = await login(request, API);
  projectId = await firstProjectId(request, session);
});

const still = (name: string, project: string) => path.join(MEDIA, `web-${name}-${project}.png`);

/** The screens the README shows, light and dark. */
const screens: Array<{ name: string; path: () => string; after?: (page: Page) => Promise<void> }> = [
  { name: 'today', path: () => '/schedule/today' },
  { name: 'inbox', path: () => '/inbox' },
  { name: 'tasks-pane', path: () => '/tasks?task=todo_visual_slides' },
  { name: 'project', path: () => `/projects/${projectId}` },
  {
    name: 'project-flow',
    path: () => `/projects/${projectId}`,
    after: async (page) => {
      await page.getByRole('button', { name: 'Flow' }).click();
      await settle(page);
    },
  },
  { name: 'attention', path: () => '/attention' },
  { name: 'week', path: () => '/schedule/week' },
  { name: 'chat', path: () => `/chats/${CONVERSATION}` },
];

for (const screen of screens) {
  test(`still: ${screen.name}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'walkthrough', 'stills come from the light and dark projects');
    await open(page, session, screen.path());
    await screen.after?.(page);
    await page.screenshot({ path: still(screen.name, testInfo.project.name) });
  });
}

/**
 * The walkthrough: capture something in the Inbox, open a task, answer the
 * agent's question. Frames only (light), stitched into a GIF afterwards.
 * Its own project and its own invocation, because the capture adds a row.
 */
test('walkthrough: inbox-to-answer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'walkthrough', 'one GIF is enough');
  const story = new Story(__dirname, 'inbox-to-answer');

  // The captured row is written by the server with the real clock and, with
  // no AI reachable, ends in the error state within a second. Show it as a
  // plain capture dated this morning instead.
  await page.route(/\/api\/todos(\?|$)/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    const rows = Array.isArray(body) ? body : (body.items ?? body.todos ?? []);
    for (const todo of rows) {
      if (todo.source === 'quick_capture' && todo.inbox_state && todo.inbox_state !== 'none') {
        todo.inbox_state = 'captured';
        todo.automation_error = null;
        todo.created_at = NOW.toISOString();
        todo.updated_at = NOW.toISOString();
      }
    }
    await route.fulfill({ response, json: body });
  });

  await open(page, session, '/inbox');
  await story.frame(page, 'inbox', 1.2);

  const capture = page.getByLabel('Add to Inbox');
  await capture.click();
  for (const chunk of ['Ask the venue ', 'about the ', 'projector']) {
    await page.keyboard.type(chunk, { delay: 20 });
    await story.frame(page, 'typing', 0.35);
  }
  await page.keyboard.press('Enter');
  await expect(page.getByText('Ask the venue about the projector')).toBeVisible();
  await settle(page);
  await story.frame(page, 'captured', 1.4);
  // The "Task created" toast would otherwise sit in the corner of every later frame.
  const dismiss = page.getByRole('button', { name: 'Dismiss' });
  if (await dismiss.count()) await dismiss.first().click();

  await page.locator('a[href="/tasks"]').first().click();
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
  await settle(page);
  await story.frame(page, 'tasks', 1.2);

  await page.getByText('Draft the slides', { exact: true }).first().click();
  const answerButton = page.getByTestId('task-agent-thread').getByRole('button', { name: 'Answer' });
  await expect(answerButton).toBeVisible();
  await settle(page);
  await story.frame(page, 'task-pane', 1.4);

  await answerButton.click();
  const answer = page.getByLabel('Your answer').first();
  await expect(answer).toBeVisible();
  await settle(page);
  await story.frame(page, 'question', 1.0);

  await answer.click();
  for (const chunk of ['April 8 to 10, ', 'near the venue']) {
    await page.keyboard.type(chunk, { delay: 20 });
    await story.frame(page, 'answer', 0.35);
  }
  await story.frame(page, 'answer-ready', 2.5);
  story.finish();
});
