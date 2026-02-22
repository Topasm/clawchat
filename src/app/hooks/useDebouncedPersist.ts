import { useCallback, useRef } from 'react';

/**
 * Hook that debounces server persistence while applying optimistic local updates immediately.
 *
 * @param id         - Entity ID (e.g. taskId, eventId). No-ops when falsy.
 * @param serverUpdate - Sends the update to the server (called after `delay` ms).
 * @param localUpdate  - Applies the update optimistically in the local store (called immediately).
 * @param delay        - Debounce delay in milliseconds (default 500).
 */
export function useDebouncedPersist<T>(
  id: string | undefined,
  serverUpdate: (id: string, updates: T) => void,
  localUpdate: (id: string, updates: T) => void,
  delay = 500,
) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback(
    (updates: T) => {
      if (!id) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        serverUpdate(id, updates);
      }, delay);
      // Immediate local update via the store's optimistic path
      localUpdate(id, updates);
    },
    [id, serverUpdate, localUpdate, delay],
  );
}
