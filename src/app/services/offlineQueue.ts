import type { Method } from 'axios';
import { logger } from './logger';

const STORAGE_KEY = 'cc-offline-queue';
const MAX_QUEUE_SIZE = 100;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface QueuedAction {
  id: string;
  method: Method;
  url: string;
  data?: unknown;
  timestamp: number;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readQueue(): QueuedAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueuedAction[];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedAction[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

/** Prune entries older than 24 hours */
function pruneStale(items: QueuedAction[]): QueuedAction[] {
  const cutoff = Date.now() - MAX_AGE_MS;
  return items.filter((item) => item.timestamp > cutoff);
}

export const offlineQueue = {
  enqueue(method: Method, url: string, data?: unknown): void {
    let items = pruneStale(readQueue());

    // Enforce max queue size — drop oldest if full
    if (items.length >= MAX_QUEUE_SIZE) {
      items = items.slice(items.length - MAX_QUEUE_SIZE + 1);
    }

    items.push({ id: generateId(), method, url, data, timestamp: Date.now() });
    writeQueue(items);
    logger.info('Offline queue: enqueued action', { method, url });
  },

  /**
   * Replay queued mutations in FIFO order.
   * Removes each item on success. Stops on auth error (401/403).
   * Returns the number of successfully flushed items.
   */
  async flush(
    apiClient: { request: (config: { method: Method; url: string; data?: unknown }) => Promise<unknown> },
  ): Promise<number> {
    const items = pruneStale(readQueue());
    if (items.length === 0) return 0;

    let flushed = 0;

    for (const item of items) {
      try {
        await apiClient.request({ method: item.method, url: item.url, data: item.data });
        flushed++;
        // Remove successfully replayed item
        const remaining = readQueue().filter((q) => q.id !== item.id);
        writeQueue(remaining);
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          logger.warn('Offline queue: auth error during flush, stopping', { status });
          break;
        }
        // Network error or server error — stop, will retry next time
        logger.warn('Offline queue: flush failed, will retry later', { url: item.url, status });
        break;
      }
    }

    logger.info(`Offline queue: flushed ${flushed}/${items.length} actions`);
    return flushed;
  },

  getItems(): QueuedAction[] {
    return pruneStale(readQueue());
  },

  getCount(): number {
    return pruneStale(readQueue()).length;
  },

  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
  },
};
