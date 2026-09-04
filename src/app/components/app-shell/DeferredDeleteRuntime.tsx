import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateTaskDerivedQueries } from '../../hooks/queries/invalidateTaskDerivedQueries';
import { queryKeys } from '../../hooks/queries/queryKeys';
import apiClient from '../../services/apiClient';
import {
  DEFERRED_DELETE_CHANGED_EVENT,
  deferredDeleteQueue,
  type DeferredDelete,
} from '../../services/deferredDeleteQueue';
import { logger } from '../../services/logger';
import { getOfflineQueueScope } from '../../services/offlineQueue';
import { useAuthStore } from '../../stores/useAuthStore';

const RETRY_DELAY_MS = 30_000;

function deleteUrl(item: DeferredDelete): string {
  return item.kind === 'todo' ? `/todos/${item.resourceId}` : `/events/${item.resourceId}`;
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('response' in error)) return undefined;
  return (error.response as { status?: number } | undefined)?.status;
}

/** Executes durable deletes after their Undo window, including after a restart. */
export default function DeferredDeleteRuntime() {
  const queryClient = useQueryClient();
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const token = useAuthStore((state) => state.token);
  const scope = getOfflineQueueScope({ serverUrl, token });

  useEffect(() => {
    if (!scope) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let disposed = false;

    const invalidate = (item: DeferredDelete) => {
      if (item.kind === 'todo') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.todos });
        void queryClient.invalidateQueries({ queryKey: queryKeys.taskRelationships });
        void invalidateTaskDerivedQueries(queryClient);
      } else {
        void queryClient.invalidateQueries({ queryKey: queryKeys.events });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.today });
    };

    const schedule = () => {
      if (disposed || running) return;
      if (timer) clearTimeout(timer);
      timer = null;
      const next = deferredDeleteQueue.getItems(scope)[0];
      if (!next) return;
      timer = setTimeout(() => void processDue(), Math.max(0, next.executeAt - Date.now()));
    };

    const processDue = async () => {
      if (disposed || running) return;
      running = true;
      if (timer) clearTimeout(timer);
      timer = null;
      const due = deferredDeleteQueue
        .getItems(scope)
        .filter((item) => item.executeAt <= Date.now());
      for (const item of due) {
        try {
          await apiClient.delete(deleteUrl(item), { queueOfflineMutation: true });
          deferredDeleteQueue.remove(item.id);
          invalidate(item);
        } catch (error) {
          if (errorStatus(error) === 404) {
            deferredDeleteQueue.remove(item.id);
            invalidate(item);
            continue;
          }
          logger.warn('Deferred delete failed; retry scheduled', {
            kind: item.kind,
            resourceId: item.resourceId,
          });
          deferredDeleteQueue.retry(item.id, RETRY_DELAY_MS);
        }
      }
      running = false;
      schedule();
    };

    const handleQueueChanged = () => schedule();
    const handleOnline = () => void processDue();
    window.addEventListener(DEFERRED_DELETE_CHANGED_EVENT, handleQueueChanged);
    window.addEventListener('online', handleOnline);
    schedule();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener(DEFERRED_DELETE_CHANGED_EVENT, handleQueueChanged);
      window.removeEventListener('online', handleOnline);
    };
  }, [queryClient, scope]);

  return null;
}
