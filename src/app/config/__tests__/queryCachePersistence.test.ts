import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/useAuthStore';
import { getQueryCacheStorageKey, queryClient } from '../queryClient';
import { initializeQueryCachePersistence, PERSIST_INTERVAL_MS } from '../queryCachePersistence';

vi.mock('../../services/platform', () => ({
  secureStorage: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

const storageKey = getQueryCacheStorageKey('host:alpha');

describe('query cache persistence scheduling', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    useAuthStore.setState({ token: 'token', hostId: 'alpha', isLoading: false });
    initializeQueryCachePersistence();
  });
  afterAll(() => vi.useRealTimers());

  beforeEach(() => {
    vi.advanceTimersByTime(PERSIST_INTERVAL_MS);
    vi.restoreAllMocks();
    queryClient.clear();
    localStorage.clear();
  });

  it('writes a persisted root once per interval however often it changes', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    for (let i = 0; i < 10; i += 1) queryClient.setQueryData(['todos'], [{ id: `todo-${i}` }]);
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PERSIST_INTERVAL_MS);

    expect(setItem).toHaveBeenCalledOnce();
    const saved = JSON.parse(localStorage.getItem(storageKey)!);
    expect(saved.entries[0].data).toEqual([{ id: 'todo-9' }]);
  });

  it('ignores queries that are not persisted and refetches that change nothing', () => {
    const todos = [{ id: 'todo-1' }];
    queryClient.setQueryData(['todos'], todos);
    vi.advanceTimersByTime(PERSIST_INTERVAL_MS);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    queryClient.setQueryData(['messages', 'chat-1'], [{ content: 'hi' }]);
    queryClient.setQueryData(['todos'], todos);
    vi.advanceTimersByTime(PERSIST_INTERVAL_MS);

    expect(setItem).not.toHaveBeenCalled();
  });

  it('writes a pending change when the page is hidden', () => {
    queryClient.setQueryData(['events'], [{ id: 'event-1' }]);

    window.dispatchEvent(new Event('pagehide'));

    expect(JSON.parse(localStorage.getItem(storageKey)!).entries[0].queryKey).toEqual(['events']);
  });
});
