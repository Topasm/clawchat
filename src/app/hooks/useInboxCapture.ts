import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, useCreateTodo } from './queries';
import { useToastStore } from '../stores/useToastStore';
import { inboxErrorMessage } from '../components/inbox/inboxErrors';
import { formatDueMoment } from '../utils/formatters';
import { translateUi } from '../i18n';
import type { TodoResponse } from '../types/api';

/**
 * The one way to add something: a line goes to the Inbox, which files it.
 * The Inbox's own bar and the ⌘N dialog both use this, so they behave alike.
 * Resolves once the server has it and rejects (after a toast) when it fails,
 * so the caller keeps the text.
 */
export default function useInboxCapture() {
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const createTodo = useCreateTodo();

  const capture = (title: string): Promise<TodoResponse | undefined> =>
    createTodo
      .mutateAsync({ title, source: 'quick_capture', inbox_state: 'classifying' })
      .then((todo) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.inboxRoutings });
        if (todo?.inbox_state === 'none' && todo.due_date) {
          addToast(
            'success',
            translateUi('Added to tasks, due {{date}}', { date: formatDueMoment(todo.due_date) }),
          );
        }
        return todo;
      })
      .catch((error: unknown) => {
        addToast('error', inboxErrorMessage(error, translateUi('Could not add to the Inbox')));
        throw error;
      });

  return { capture, busy: createTodo.isPending };
}
