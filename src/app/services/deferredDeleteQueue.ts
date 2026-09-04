import { logger } from './logger';

const STORAGE_KEY = 'cc-deferred-deletes:v1';
const STORAGE_VERSION = 1;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const DEFERRED_DELETE_CHANGED_EVENT = 'clawchat:deferred-delete-changed';

export type DeferredDeleteKind = 'todo' | 'event';

export interface DeferredDelete {
  id: string;
  scope: string;
  kind: DeferredDeleteKind;
  resourceId: string;
  executeAt: number;
  createdAt: number;
}

interface PersistedDeferredDeletes {
  version: number;
  items: DeferredDelete[];
}

function isDeferredDelete(value: unknown): value is DeferredDelete {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<DeferredDelete>;
  return (
    typeof item.id === 'string' &&
    typeof item.scope === 'string' &&
    item.scope.length > 0 &&
    (item.kind === 'todo' || item.kind === 'event') &&
    typeof item.resourceId === 'string' &&
    item.resourceId.length > 0 &&
    typeof item.executeAt === 'number' &&
    Number.isFinite(item.executeAt) &&
    typeof item.createdAt === 'number' &&
    Number.isFinite(item.createdAt)
  );
}

function readItems(): DeferredDelete[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const payload = JSON.parse(raw) as Partial<PersistedDeferredDeletes>;
    if (payload.version !== STORAGE_VERSION || !Array.isArray(payload.items)) {
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }
    const cutoff = Date.now() - MAX_AGE_MS;
    return payload.items.filter(isDeferredDelete).filter((item) => item.createdAt > cutoff);
  } catch {
    return [];
  }
}

function writeItems(items: DeferredDelete[]): boolean {
  try {
    const payload: PersistedDeferredDeletes = { version: STORAGE_VERSION, items };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    window.dispatchEvent(new Event(DEFERRED_DELETE_CHANGED_EVENT));
    return true;
  } catch {
    logger.warn('Deferred delete queue: unable to persist pending delete');
    return false;
  }
}

function entryId(scope: string, kind: DeferredDeleteKind, resourceId: string): string {
  return `${scope}|${kind}:${resourceId}`;
}

export const deferredDeleteQueue = {
  enqueue(
    scope: string | null,
    kind: DeferredDeleteKind,
    resourceId: string,
    delayMs = 5_000,
  ): boolean {
    if (!scope) return false;
    const now = Date.now();
    const id = entryId(scope, kind, resourceId);
    const items = readItems().filter((item) => item.id !== id);
    items.push({ id, scope, kind, resourceId, executeAt: now + delayMs, createdAt: now });
    return writeItems(items);
  },

  cancel(scope: string | null, kind: DeferredDeleteKind, resourceId: string): boolean {
    if (!scope) return false;
    const id = entryId(scope, kind, resourceId);
    const items = readItems();
    const remaining = items.filter((item) => item.id !== id);
    if (remaining.length === items.length) return false;
    return writeItems(remaining);
  },

  remove(id: string): void {
    writeItems(readItems().filter((item) => item.id !== id));
  },

  retry(id: string, delayMs: number): void {
    writeItems(
      readItems().map((item) =>
        item.id === id ? { ...item, executeAt: Date.now() + delayMs } : item,
      ),
    );
  },

  getItems(scope: string | null): DeferredDelete[] {
    if (!scope) return [];
    return readItems()
      .filter((item) => item.scope === scope)
      .sort((left, right) => left.executeAt - right.executeAt);
  },

  clearAll(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage may be unavailable in private or restricted browser contexts.
    }
  },
};
