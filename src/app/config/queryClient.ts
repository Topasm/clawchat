import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: true,
      gcTime: 1000 * 60 * 60 * 24,
    },
    mutations: {
      retry: 0,
    },
  },
});

const LEGACY_CACHE_KEY = 'cc-query-cache';
const CACHE_KEY_PREFIX = 'cc-query-cache:v2:';
const CACHE_VERSION = 2;
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24;
const CACHE_MAX_BYTES = 2 * 1024 * 1024;
const PERSISTED_QUERY_ROOTS = new Set(['todos', 'events', 'projects', 'today']);

interface QueryCacheScopeInput {
  hostId?: string | null;
  serverUrl?: string | null;
}

interface PersistedEntry {
  queryKey: readonly unknown[];
  data: unknown;
  updatedAt: number;
}

interface PersistedCache {
  version: number;
  scope: string;
  entries: PersistedEntry[];
}

function scopeHash(scope: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < scope.length; index += 1) {
    hash ^= scope.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function cacheStorageKey(scope: string): string {
  return `${CACHE_KEY_PREFIX}${scopeHash(scope)}`;
}

function removeStorageItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in private or restricted browser contexts.
  }
}

export function isPersistedQueryKey(queryKey: readonly unknown[]): boolean {
  return typeof queryKey[0] === 'string' && PERSISTED_QUERY_ROOTS.has(queryKey[0]);
}

function encodedSize(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function getQueryCacheScope(input: QueryCacheScopeInput): string | null {
  if (input.hostId?.trim()) return `host:${input.hostId.trim()}`;
  if (!input.serverUrl?.trim()) return null;
  return `server:${input.serverUrl.trim().replace(/\/+$/, '').toLowerCase()}`;
}

/** Persist only bounded offline-critical data for a single host. */
export function persistQueryCache(scope: string | null, maxBytes = CACHE_MAX_BYTES): void {
  if (!scope) return;
  try {
    const entries = queryClient
      .getQueryCache()
      .getAll()
      .filter(
        (query) =>
          query.state.status === 'success' &&
          query.state.data != null &&
          isPersistedQueryKey(query.queryKey),
      )
      .map((query) => ({
        queryKey: query.queryKey,
        data: query.state.data,
        updatedAt: query.state.dataUpdatedAt,
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt);

    // Serialize each entry once and keep the newest that fit, rather than
    // re-serializing the whole payload after every dropped entry. The result
    // is byte-for-byte what JSON.stringify(payload) would produce.
    const header = `{"version":${CACHE_VERSION},"scope":${JSON.stringify(scope)},"entries":[`;
    const footer = ']}';
    let size = encodedSize(header) + encodedSize(footer);
    const kept: string[] = [];
    for (const entry of entries) {
      const serialized = JSON.stringify(entry);
      const entrySize = encodedSize(serialized) + (kept.length > 0 ? 1 : 0);
      if (size + entrySize > maxBytes) break;
      kept.push(serialized);
      size += entrySize;
    }

    if (kept.length === 0) {
      removeStorageItem(cacheStorageKey(scope));
      return;
    }
    localStorage.setItem(cacheStorageKey(scope), `${header}${kept.join(',')}${footer}`);
  } catch {
    // Storage may be unavailable or full. Runtime query data remains intact.
  }
}

/** Restore a cache only when its embedded host scope matches exactly. */
export function restoreQueryCache(scope: string | null): void {
  if (!scope) return;
  try {
    const raw = localStorage.getItem(cacheStorageKey(scope));
    if (!raw) return;
    const payload = JSON.parse(raw) as Partial<PersistedCache>;
    if (
      payload.version !== CACHE_VERSION ||
      payload.scope !== scope ||
      !Array.isArray(payload.entries)
    ) {
      removeStorageItem(cacheStorageKey(scope));
      return;
    }

    const now = Date.now();
    for (const entry of payload.entries) {
      if (
        !entry ||
        !Array.isArray(entry.queryKey) ||
        !isPersistedQueryKey(entry.queryKey) ||
        typeof entry.updatedAt !== 'number' ||
        now - entry.updatedAt > CACHE_MAX_AGE_MS
      ) {
        continue;
      }
      queryClient.setQueryData(entry.queryKey, entry.data, {
        updatedAt: entry.updatedAt,
      });
    }
  } catch {
    removeStorageItem(cacheStorageKey(scope));
  }
}

export function clearQueryCache(scope: string | null): void {
  queryClient.clear();
  if (scope) removeStorageItem(cacheStorageKey(scope));
  removeStorageItem(LEGACY_CACHE_KEY);
}

export function removeLegacyQueryCache(): void {
  removeStorageItem(LEGACY_CACHE_KEY);
}

export function getQueryCacheStorageKey(scope: string): string {
  return cacheStorageKey(scope);
}
