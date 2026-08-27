import {
  clearQueryCache,
  getQueryCacheScope,
  persistQueryCache,
  queryClient,
  removeLegacyQueryCache,
  restoreQueryCache,
} from './queryClient';
import { useAuthStore } from '../stores/useAuthStore';

const PERSIST_DEBOUNCE_MS = 1_000;

let initialized = false;
let activeScope: string | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function cancelScheduledPersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
}

function schedulePersist(): void {
  if (!activeScope) return;
  cancelScheduledPersist();
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistQueryCache(activeScope);
  }, PERSIST_DEBOUNCE_MS);
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
  activeScope = nextScope;
  restoreQueryCache(activeScope);
}

/** Install one synchronous auth-scope listener and debounced cache writer. */
export function initializeQueryCachePersistence(): void {
  if (initialized) return;
  initialized = true;
  removeLegacyQueryCache();
  syncAuthScope();

  useAuthStore.subscribe(syncAuthScope);
  queryClient.getQueryCache().subscribe(schedulePersist);
  window.addEventListener('beforeunload', () => {
    cancelScheduledPersist();
    persistQueryCache(activeScope);
  });
}
