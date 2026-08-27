import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearQueryCache,
  getQueryCacheScope,
  getQueryCacheStorageKey,
  persistQueryCache,
  queryClient,
  restoreQueryCache,
} from '../queryClient';

describe('query cache persistence', () => {
  beforeEach(() => {
    queryClient.clear();
    localStorage.clear();
  });

  it('persists only offline-critical query roots', () => {
    const scope = 'host:alpha';
    queryClient.setQueryData(['todos'], [{ id: 'todo-1' }]);
    queryClient.setQueryData(['events'], [{ id: 'event-1' }]);
    queryClient.setQueryData(['messages', 'chat-1'], [{ content: 'private' }]);
    queryClient.setQueryData(['admin', 'config'], { secret: true });

    persistQueryCache(scope);

    const raw = localStorage.getItem(getQueryCacheStorageKey(scope));
    expect(raw).not.toBeNull();
    const roots = JSON.parse(raw!).entries.map(
      (entry: { queryKey: string[] }) => entry.queryKey[0],
    );
    expect(roots.sort()).toEqual(['events', 'todos']);
  });

  it('isolates cached data between hosts', () => {
    queryClient.setQueryData(['todos'], [{ id: 'alpha' }]);
    persistQueryCache('host:alpha');
    queryClient.clear();

    queryClient.setQueryData(['todos'], [{ id: 'beta' }]);
    persistQueryCache('host:beta');
    queryClient.clear();

    restoreQueryCache('host:alpha');
    expect(queryClient.getQueryData(['todos'])).toEqual([{ id: 'alpha' }]);
  });

  it('rejects a payload whose embedded scope does not match', () => {
    const storageKey = getQueryCacheStorageKey('host:alpha');
    localStorage.setItem(storageKey, JSON.stringify({
      version: 2,
      scope: 'host:beta',
      entries: [{ queryKey: ['todos'], data: ['wrong'], updatedAt: Date.now() }],
    }));

    restoreQueryCache('host:alpha');

    expect(queryClient.getQueryData(['todos'])).toBeUndefined();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('clears both memory and the selected host storage', () => {
    const scope = 'host:alpha';
    queryClient.setQueryData(['todos'], ['cached']);
    persistQueryCache(scope);

    clearQueryCache(scope);

    expect(queryClient.getQueryData(['todos'])).toBeUndefined();
    expect(localStorage.getItem(getQueryCacheStorageKey(scope))).toBeNull();
  });

  it('prefers stable host identity and normalizes server URLs', () => {
    expect(getQueryCacheScope({ hostId: ' host-1 ', serverUrl: 'HTTPS://A/' }))
      .toBe('host:host-1');
    expect(getQueryCacheScope({ serverUrl: 'HTTPS://Example.COM/' }))
      .toBe('server:https://example.com');
  });
});
