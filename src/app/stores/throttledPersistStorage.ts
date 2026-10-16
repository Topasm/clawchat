import type { PersistStorage, StorageValue } from 'zustand/middleware';

export interface ThrottledPersistStorage<S> extends PersistStorage<S> {
  /** Write any pending value now. */
  flush: () => void;
}

/**
 * zustand's persist middleware hands the storage a new value on every
 * setState. For a store that changes per streamed token or keystroke, writing
 * each one means JSON-stringifying the whole persisted slice every time. This
 * storage keeps only the latest value and writes it at most once per
 * `intervalMs`, plus whenever the page is hidden or unloads, so a reload or
 * crash loses at most one interval of changes.
 *
 * Every storage access is best effort: persistence is a recovery layer, and
 * in-memory state must keep working when storage is unavailable or full.
 */
export function createThrottledPersistStorage<S>(
  getStorage: () => Storage,
  intervalMs = 1000,
): ThrottledPersistStorage<S> {
  const pending = new Map<string, StorageValue<S>>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.size === 0) return;
    const entries = [...pending];
    pending.clear();
    for (const [name, value] of entries) {
      try {
        getStorage().setItem(name, JSON.stringify(value));
      } catch {
        // Best effort only.
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  return {
    getItem: (name) => {
      try {
        const raw = getStorage().getItem(name);
        return raw === null ? null : (JSON.parse(raw) as StorageValue<S>);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pending.set(name, value);
      timer ??= setTimeout(flush, intervalMs);
    },
    removeItem: (name) => {
      pending.delete(name);
      try {
        getStorage().removeItem(name);
      } catch {
        // Best effort only.
      }
    },
    flush,
  };
}
