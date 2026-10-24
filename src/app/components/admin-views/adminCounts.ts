import { translateUi } from '../../i18n';

/** The rows the server counts, in the reader's words. */
const COUNT_LABELS: Record<string, string> = {
  conversations: 'Conversations',
  messages: 'Messages',
  todos: 'Tasks',
  events: 'Events',
  agent_tasks: 'Agent runs',
  attachments: 'Attachments',
};

/** "Tasks" / "작업" for the server's `todos`; an unknown key is shown as words. */
export function countLabel(key: string): string {
  return translateUi(COUNT_LABELS[key] ?? key.replace(/_/g, ' '));
}
