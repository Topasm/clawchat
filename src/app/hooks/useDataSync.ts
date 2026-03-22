import { useCallback } from 'react';
import { useTodosQuery, useEventsQuery, useConversationsQuery, useProjectsQuery } from './queries';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useAuthStore } from '../stores/useAuthStore';

/**
 * Central data-sync hook.
 * Activates React Query hooks that fetch + validate data.
 * Queries are disabled when serverUrl is not set.
 */
export function useDataSync() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const todosQ = useTodosQuery();
  const eventsQ = useEventsQuery();
  const convsQ = useConversationsQuery();
  const projsQ = useProjectsQuery();

  const syncing = todosQ.isLoading || eventsQ.isLoading || convsQ.isLoading || projsQ.isLoading;

  const refresh = useCallback(() => {
    if (!serverUrl) return;
    todosQ.refetch();
    eventsQ.refetch();
    convsQ.refetch();
    projsQ.refetch();
    useSettingsStore.getState().fetchSettings();
  }, [serverUrl, todosQ, eventsQ, convsQ, projsQ]);

  return { syncing, refresh };
}

export default useDataSync;
