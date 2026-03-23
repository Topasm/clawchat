import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: true,
      // Keep data in cache for 24 hours for offline support
      gcTime: 1000 * 60 * 60 * 24,
    },
    mutations: {
      retry: 0,
    },
  },
});

// --- Simple query cache persistence to localStorage ---

const CACHE_KEY = 'cc-query-cache';
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24; // 24 hours

/** Save critical query data to localStorage for offline access. */
export function persistQueryCache(): void {
  try {
    const cache = queryClient.getQueryCache();
    const queries = cache.getAll();
    const serializable: Record<string, { data: unknown; updatedAt: number }> = {};

    for (const query of queries) {
      // Only persist successful queries with data
      if (query.state.status === 'success' && query.state.data != null) {
        const key = JSON.stringify(query.queryKey);
        serializable[key] = {
          data: query.state.data,
          updatedAt: query.state.dataUpdatedAt,
        };
      }
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(serializable));
  } catch {
    // localStorage might be full — silently skip
  }
}

/** Restore cached query data from localStorage on app start. */
export function restoreQueryCache(): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;

    const entries = JSON.parse(raw) as Record<string, { data: unknown; updatedAt: number }>;
    const now = Date.now();

    for (const [keyStr, entry] of Object.entries(entries)) {
      if (now - entry.updatedAt > CACHE_MAX_AGE_MS) continue; // Expired
      const queryKey = JSON.parse(keyStr);
      queryClient.setQueryData(queryKey, entry.data);
    }
  } catch {
    // Corrupted cache — ignore
  }
}

// Restore on load
restoreQueryCache();

// Persist periodically (every 30 seconds) and on page unload
setInterval(persistQueryCache, 30_000);
window.addEventListener('beforeunload', persistQueryCache);
