import type { QueryCacheNotifyEvent } from '@tanstack/react-query';
import {
  clearQueryCache,
  getQueryCacheScope,
  isPersistedQueryKey,
  persistQueryCache,
  queryClient,
  removeLegacyQueryCache,
  restoreQueryCache,
} from './queryClient';
import { useAuthStore } from '../stores/useAuthStore';

export const PERSIST_INTERVAL_MS = 5_000;

let initialized = false;
let activeScope: string | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
// The data each persisted query last held. Structural sharing keeps the
// reference when a refetch returns the same thing, so an unchanged reference
// means there is nothing new to write.
let lastSeenData = new WeakMap<object, unknown>();

function cancelScheduledPersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
}

function persistNow(): void {
  cancelScheduledPersist();
  persistQueryCache(activeScope);
}

function flushPendingPersist(): void {
  if (persistTimer) persistNow();
}

/**
 * Only a change to a persisted root's data is worth a write. Fetch state,
 * observers and every other query fire cache events too, and each write
 * serializes up to 2 MB.
 */
export function changesPersistedData(event: QueryCacheNotifyEvent): boolean {
  if (!isPersistedQueryKey(event.query.queryKey)) return false;
  if (event.type === 'removed') return true;
  if (event.type !== 'updated' || event.action.type !== 'success') return false;
  const data: unknown = event.query.state.data;
  if (lastSeenData.has(event.query) && lastSeenData.get(event.query) === data) return false;
  lastSeenData.set(event.query, data);
  return true;
}

function handleCacheEvent(event: QueryCacheNotifyEvent): void {
  if (!activeScope || !changesPersistedData(event)) return;
  // Write at most once per interval; changes made meanwhile ride along.
  persistTimer ??= setTimeout(persistNow, PERSIST_INTERVAL_MS);
}

function syncAuthScope(): void {
  const auth = useAuthStore.getState();
  if (auth.isLoading) return;
  const nextScope = auth.token ? getQueryCacheScope(auth) : null;
  if (nextScope === activeScope) return;

  cancelScheduledPersist();
  if (!nextScope) {
    clearQueryCache(activeScope);
    activeScope = null;
    return;
  }

  if (activeScope) persistQueryCache(activeScope);
  queryClient.clear();
  lastSeenData = new WeakMap();
  activeScope = nextScope;
  restoreQueryCache(activeScope);
}

/** Install one synchronous auth-scope listener and throttled cache writer. */
export function initializeQueryCachePersistence(): void {
  if (initialized) return;
  initialized = true;
  removeLegacyQueryCache();
  syncAuthScope();

  useAuthStore.subscribe(syncAuthScope);
  queryClient.getQueryCache().subscribe(handleCacheEvent);
  // Unload refreshes every entry's timestamp; hiding only writes what is due.
  window.addEventListener('beforeunload', persistNow);
  window.addEventListener('pagehide', flushPendingPersist);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingPersist();
  });
}
