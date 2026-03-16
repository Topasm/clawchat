import { useCallback } from 'react';
import { useTodosQuery, useEventsQuery, useConversationsQuery } from './queries';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useAuthStore } from '../stores/useAuthStore';

/**
 * Central data-sync hook.
 * Activates React Query hooks that fetch + validate + sync to Zustand.
 * In demo mode (no serverUrl), queries are disabled — stores keep seed data.
 */
export function useDataSync() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const todosQ = useTodosQuery();
  const eventsQ = useEventsQuery();
  const convsQ = useConversationsQuery();

  const syncing = todosQ.isLoading || eventsQ.isLoading || convsQ.isLoading;

  const refresh = useCallback(() => {
    if (!serverUrl) return;
    todosQ.refetch();
    eventsQ.refetch();
    convsQ.refetch();
    useSettingsStore.getState().fetchSettings();
  }, [serverUrl, todosQ, eventsQ, convsQ]);

  return { syncing, refresh };
}

export default useDataSync;
