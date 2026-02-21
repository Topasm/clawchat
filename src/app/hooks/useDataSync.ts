import { useEffect, useCallback, useState } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useModuleStore } from '../stores/useModuleStore';
import { useChatStore } from '../stores/useChatStore';

/**
 * Central data-sync hook.
 * - Runs on app mount (called from Layout.tsx).
 * - When `serverUrl` is set, fetches todos, events, memos, and conversations in parallel.
 * - When `serverUrl` is null (demo mode), this is a no-op — stores keep their seed data.
 * - Re-fetches whenever `serverUrl` changes.
 * - Exposes a manual `refresh()` function and a `syncing` loading flag.
 */
export function useDataSync() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const fetchTodos = useModuleStore((s) => s.fetchTodos);
  const fetchEvents = useModuleStore((s) => s.fetchEvents);
  const fetchMemos = useModuleStore((s) => s.fetchMemos);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    if (!serverUrl) return;
    setSyncing(true);
    try {
      await Promise.all([
        fetchTodos(),
        fetchEvents(),
        fetchMemos(),
        fetchConversations(),
      ]);
    } catch (err) {
      console.warn('Data sync error:', err);
    } finally {
      setSyncing(false);
    }
  }, [serverUrl, fetchTodos, fetchEvents, fetchMemos, fetchConversations]);

  // Initial fetch + refetch when serverUrl changes
  useEffect(() => {
    if (!serverUrl) return;
    refresh();
  }, [serverUrl, refresh]);

  return { syncing, refresh };
}

export default useDataSync;
