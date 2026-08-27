import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOfflineQueueScope, offlineQueue } from '../offlineQueue';

function createToken(subject: string, nonce = 'token'): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encode({ alg: 'none' })}.${encode({ sub: subject, nonce })}.signature`;
}

describe('offlineQueue', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('normalizes the server and remains stable across token refreshes', () => {
    const first = getOfflineQueueScope({
      serverUrl: ' HTTPS://Example.COM:443/base///?ignored=yes#fragment ',
      token: createToken(' device-1 ', 'first'),
    });
    const refreshed = getOfflineQueueScope({
      serverUrl: 'https://example.com/base',
      token: createToken('device-1', 'refreshed'),
    });

    expect(first).toBe(refreshed);
    expect(first).toContain('principal:device-1');
  });

  it('refuses to queue work without both a valid server and principal', () => {
    expect(offlineQueue.enqueue(null, 'post', '/todos', { title: 'private' })).toBe(false);
    expect(
      getOfflineQueueScope({ serverUrl: 'https://host.example', token: 'invalid' }),
    ).toBeNull();
    expect(offlineQueue.getItems(null)).toEqual([]);
  });

  it('flushes only the current server and principal scope', async () => {
    const scopeA = getOfflineQueueScope({
      serverUrl: 'https://a.example',
      token: createToken('user-a'),
    });
    const scopeB = getOfflineQueueScope({
      serverUrl: 'https://b.example',
      token: createToken('user-b'),
    });
    offlineQueue.enqueue(scopeA, 'post', '/todos', { title: 'A' });
    offlineQueue.enqueue(scopeB, 'delete', '/todos/2');
    const request = vi.fn().mockResolvedValue({});

    await expect(offlineQueue.flush(scopeB, { request })).resolves.toBe(1);

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({ method: 'delete', url: '/todos/2', data: undefined });
    expect(offlineQueue.getCount(scopeA)).toBe(1);
    expect(offlineQueue.getCount(scopeB)).toBe(0);
  });

  it('isolates queued work between principals on the same server', () => {
    const serverUrl = 'https://shared.example';
    const originalScope = getOfflineQueueScope({ serverUrl, token: createToken('user-a') });
    const nextScope = getOfflineQueueScope({ serverUrl, token: createToken('user-b') });
    offlineQueue.enqueue(originalScope, 'patch', '/settings', { private: true });

    expect(offlineQueue.getCount(null)).toBe(0);
    expect(offlineQueue.getCount(nextScope)).toBe(0);
    expect(offlineQueue.getCount(originalScope)).toBe(1);
  });

  it('removes an unscoped legacy queue without replaying it', async () => {
    localStorage.setItem(
      'cc-offline-queue',
      JSON.stringify([{ id: 'legacy', method: 'post', url: '/todos', timestamp: Date.now() }]),
    );
    const scope = getOfflineQueueScope({
      serverUrl: 'https://current.example',
      token: createToken('current-user'),
    });
    const request = vi.fn();

    await expect(offlineQueue.flush(scope, { request })).resolves.toBe(0);

    expect(request).not.toHaveBeenCalled();
    expect(localStorage.getItem('cc-offline-queue')).toBeNull();
  });

  it('stops on an authentication error and retains remaining work', async () => {
    const scope = getOfflineQueueScope({
      serverUrl: 'https://host.example',
      token: createToken('user'),
    });
    offlineQueue.enqueue(scope, 'post', '/todos/1');
    offlineQueue.enqueue(scope, 'post', '/todos/2');
    const request = vi.fn().mockRejectedValue({ response: { status: 401 } });

    await expect(offlineQueue.flush(scope, { request })).resolves.toBe(0);

    expect(request).toHaveBeenCalledOnce();
    expect(offlineQueue.getCount(scope)).toBe(2);
  });
});
