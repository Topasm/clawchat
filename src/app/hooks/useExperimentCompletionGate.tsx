import { useCallback, useState } from 'react';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import apiClient from '../services/apiClient';
import { useToastStore } from '../stores/useToastStore';
import type { TaskStatus, TodoResponse } from '../types/api';
import { translateUi } from '../i18n';

interface PendingCompletion {
  todo: TodoResponse;
  proceed: () => void;
}

export function isExperimentTask(todo: Pick<TodoResponse, 'tags'>): boolean {
  return Boolean(todo.tags?.some((tag) => tag.replace(/^#/u, '').startsWith('exp/')));
}

export default function useExperimentCompletionGate() {
  const [pending, setPending] = useState<PendingCompletion | null>(null);

  const requestStatusChange = useCallback(
    (todo: TodoResponse, nextStatus: TaskStatus, proceed: () => void) => {
      if (nextStatus === 'completed' && todo.status !== 'completed' && isExperimentTask(todo)) {
        setPending({ todo, proceed });
        return;
      }
      proceed();
    },
    [],
  );

  const proceed = (recordMissingVerdict: boolean) => {
    const completion = pending;
    setPending(null);
    if (!completion) return;
    completion.proceed();
    if (recordMissingVerdict) {
      void apiClient
        .post('/task-comments', {
          todo_id: completion.todo.id,
          content: '판정 미기록',
        })
        .catch(() => {
          useToastStore
            .getState()
            .addToast('error', translateUi('Could not record the missing-verdict comment'));
        });
    }
  };

  return {
    requestStatusChange,
    confirmationDialog: (
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={translateUi('Complete experiment task')}
        description={translateUi('Did you record the verdict in the original document?')}
        confirmLabel={translateUi('Recorded')}
        cancelLabel={translateUi('Later')}
        onConfirm={() => proceed(false)}
        onCancel={() => proceed(true)}
      />
    ),
  };
}
