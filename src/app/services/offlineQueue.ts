import type { Method } from 'axios';
import { logger } from './logger';

const STORAGE_KEY = 'cc-offline-queue:v2';
const LEGACY_STORAGE_KEY = 'cc-offline-queue';
const STORAGE_VERSION = 2;
const MAX_QUEUE_SIZE = 100;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface QueuedAction {
  id: string;
  scope: string;
  method: Method;
  url: string;
  data?: unknown;
  timestamp: number;
}

interface PersistedQueue {
  version: number;
  items: QueuedAction[];
}

interface OfflineQueueScopeInput {
  serverUrl?: string | null;
  token?: string | null;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function removeLegacyQueue(): void {
  try {
    // Legacy entries have no server or principal identity. They cannot be
    // migrated safely because replaying them could mutate a different host.
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in private or restricted browser contexts.
  }
}

function isQueuedAction(value: unknown): value is QueuedAction {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<QueuedAction>;
  return (
    typeof item.id === 'string' &&
    typeof item.scope === 'string' &&
    item.scope.length > 0 &&
    typeof item.method === 'string' &&
    typeof item.url === 'string' &&
    typeof item.timestamp === 'number' &&
    Number.isFinite(item.timestamp)
  );
}

function readQueue(): QueuedAction[] {
  removeLegacyQueue();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const payload = JSON.parse(raw) as Partial<PersistedQueue>;
    if (payload.version !== STORAGE_VERSION || !Array.isArray(payload.items)) {
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }
    return payload.items.filter(isQueuedAction);
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedAction[]): boolean {
  try {
    const payload: PersistedQueue = { version: STORAGE_VERSION, items };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    logger.warn('Offline queue: unable to persist queued actions');
    return false;
  }
}

/** Prune entries older than 24 hours. */
function pruneStale(items: QueuedAction[]): QueuedAction[] {
  const cutoff = Date.now() - MAX_AGE_MS;
  return items.filter((item) => item.timestamp > cutoff);
}

function normalizeServerUrl(serverUrl: string): string | null {
  const trimmed = serverUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function getJwtSubject(token: string): string | null {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return null;
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Derive a stable, non-secret queue scope from the authenticated endpoint and
 * JWT principal. Refreshing a token for the same subject keeps the same scope.
 */
export function getOfflineQueueScope(input: OfflineQueueScopeInput): string | null {
  const server = input.serverUrl ? normalizeServerUrl(input.serverUrl) : null;
  const principal = input.token ? getJwtSubject(input.token) : null;
  if (!server || !principal) return null;
  return `server:${encodeURIComponent(server)}|principal:${encodeURIComponent(principal)}`;
}

export const offlineQueue = {
  enqueue(scope: string | null, method: Method, url: string, data?: unknown): boolean {
    if (!scope) {
      logger.warn('Offline queue: mutation was not queued because its session scope is unknown', {
        method,
        url,
      });
      return false;
    }

    let items = pruneStale(readQueue());
    const scopedItems = items.filter((item) => item.scope === scope);

    // Enforce the limit per account/host without evicting another scope's work.
    if (scopedItems.length >= MAX_QUEUE_SIZE) {
      const idsToDrop = new Set(
        scopedItems.slice(0, scopedItems.length - MAX_QUEUE_SIZE + 1).map((item) => item.id),
      );
      items = items.filter((item) => !idsToDrop.has(item.id));
    }

    items.push({ id: generateId(), scope, method, url, data, timestamp: Date.now() });
    const persisted = writeQueue(items);
    if (persisted) logger.info('Offline queue: enqueued action', { method, url });
    return persisted;
  },

  /**
   * Replay queued mutations for one authenticated scope in FIFO order.
   * Removes each item on success. Stops on auth error (401/403).
   * Returns the number of successfully flushed items.
   */
  async flush(
    scope: string | null,
    apiClient: {
      request: (config: { method: Method; url: string; data?: unknown }) => Promise<unknown>;
    },
  ): Promise<number> {
    if (!scope) return 0;
    const allItems = pruneStale(readQueue());
    const items = allItems.filter((item) => item.scope === scope);
    if (items.length === 0) return 0;

    let flushed = 0;

    for (const item of items) {
      try {
        await apiClient.request({ method: item.method, url: item.url, data: item.data });
        flushed++;
        // Remove only the successfully replayed item; preserve other scopes.
        const remaining = readQueue().filter((queuedItem) => queuedItem.id !== item.id);
        writeQueue(remaining);
      } catch (error: unknown) {
        const status =
          error && typeof error === 'object' && 'response' in error
            ? (error.response as { status?: number } | undefined)?.status
            : undefined;
        if (status === 401 || status === 403) {
          logger.warn('Offline queue: auth error during flush, stopping', { status });
          break;
        }
        // Network error or server error — stop, will retry next time.
        logger.warn('Offline queue: flush failed, will retry later', {
          url: item.url,
          status,
        });
        break;
      }
    }

    logger.info(`Offline queue: flushed ${flushed}/${items.length} actions`);
    return flushed;
  },

  getItems(scope: string | null): QueuedAction[] {
    if (!scope) return [];
    return pruneStale(readQueue()).filter((item) => item.scope === scope);
  },

  getCount(scope: string | null): number {
    if (!scope) return 0;
    return pruneStale(readQueue()).filter((item) => item.scope === scope).length;
  },

  clear(scope: string | null): void {
    if (!scope) return;
    writeQueue(readQueue().filter((item) => item.scope !== scope));
  },

  clearAll(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Storage may be unavailable in private or restricted browser contexts.
    }
  },
};
