import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../useAuthStore';
import { getQueryCacheStorageKey, persistQueryCache, queryClient } from '../../config/queryClient';
import { getOfflineQueueScope, offlineQueue } from '../../services/offlineQueue';

function createToken(subject: string): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encode({ alg: 'none' })}.${encode({ sub: subject })}.signature`;
}

// Mock the secure storage to avoid real storage calls
vi.mock('../../services/platform', () => ({
  secureStorage: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('useAuthStore', () => {
  beforeEach(() => {
    queryClient.clear();
    localStorage.clear();
    // Reset store to initial state
    useAuthStore.setState({
      token: null,
      refreshToken: null,
      serverUrl: null,
      hostId: null,
      hostPublicKey: null,
      relayUrl: null,
      isLoading: false,
      connectionStatus: 'disconnected',
    });
  });

  it('starts with null auth values and disconnected connection status', () => {
    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.serverUrl).toBeNull();
    expect(state.connectionStatus).toBe('disconnected');
  });

  it('login sets token, refreshToken, and serverUrl', async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        access_token: 'test-token',
        refresh_token: 'test-refresh',
      }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

    await useAuthStore.getState().login('http://localhost:3000', '1234');

    const state = useAuthStore.getState();
    expect(state.token).toBe('test-token');
    expect(state.refreshToken).toBe('test-refresh');
    expect(state.serverUrl).toBe('http://localhost:3000');
    expect(state.isLoading).toBe(false);

    vi.restoreAllMocks();
  });

  it('login throws on non-ok response', async () => {
    const mockResponse = {
      ok: false,
      json: vi.fn().mockResolvedValue({ error: { message: 'Invalid PIN' } }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

    await expect(useAuthStore.getState().login('http://localhost:3000', 'wrong')).rejects.toThrow(
      'Invalid PIN',
    );

    vi.restoreAllMocks();
  });

  it('logout clears auth state and resets connectionStatus to disconnected', async () => {
    // Set up logged-in state
    useAuthStore.setState({
      token: 'test-token',
      refreshToken: 'test-refresh',
      serverUrl: 'http://localhost:3000',
      connectionStatus: 'connected',
    });

    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.serverUrl).toBeNull();
    expect(state.connectionStatus).toBe('disconnected');
  });

  it('best-effort revokes the server refresh session on logout', () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    useAuthStore.setState({
      token: 'access-token',
      refreshToken: 'refresh-token',
      serverUrl: 'https://host.example',
    });

    useAuthStore.getState().logout();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://host.example/api/auth/logout',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refresh_token: 'refresh-token' }),
        keepalive: true,
      }),
    );
    fetchSpy.mockRestore();
  });

  it('logout clears persisted and in-memory data for the active host', () => {
    useAuthStore.setState({
      token: 'test-token',
      serverUrl: 'https://host.example',
      hostId: 'host-1',
    });
    queryClient.setQueryData(['todos'], [{ id: 'private' }]);
    persistQueryCache('host:host-1');
    expect(localStorage.getItem(getQueryCacheStorageKey('host:host-1'))).not.toBeNull();

    useAuthStore.getState().logout();

    expect(queryClient.getQueryData(['todos'])).toBeUndefined();
    expect(localStorage.getItem(getQueryCacheStorageKey('host:host-1'))).toBeNull();
  });

  it('keeps offline mutations scoped to the signed-out principal', () => {
    const serverUrl = 'https://host.example';
    const token = createToken('user-a');
    const originalScope = getOfflineQueueScope({ serverUrl, token });
    const otherScope = getOfflineQueueScope({ serverUrl, token: createToken('user-b') });
    useAuthStore.setState({ token, serverUrl });
    offlineQueue.enqueue(originalScope, 'post', '/todos', { title: 'private' });

    useAuthStore.getState().logout();

    expect(offlineQueue.getCount(originalScope)).toBe(1);
    expect(offlineQueue.getCount(otherScope)).toBe(0);
    expect(offlineQueue.getCount(getOfflineQueueScope(useAuthStore.getState()))).toBe(0);
  });

  it('setToken updates only the token', () => {
    useAuthStore.getState().setToken('new-token');
    expect(useAuthStore.getState().token).toBe('new-token');
  });

  it('replaces access and refresh tokens together after rotation', () => {
    useAuthStore.setState({ token: 'old-token', refreshToken: 'old-refresh' });

    useAuthStore.getState().setTokens('new-token', 'new-refresh');

    expect(useAuthStore.getState().token).toBe('new-token');
    expect(useAuthStore.getState().refreshToken).toBe('new-refresh');
  });

  it('setConnectionStatus updates the connection status', () => {
    useAuthStore.getState().setConnectionStatus('connected');
    expect(useAuthStore.getState().connectionStatus).toBe('connected');

    useAuthStore.getState().setConnectionStatus('reconnecting');
    expect(useAuthStore.getState().connectionStatus).toBe('reconnecting');
  });

  it('setLoading updates the loading flag', () => {
    useAuthStore.getState().setLoading(true);
    expect(useAuthStore.getState().isLoading).toBe(true);

    useAuthStore.getState().setLoading(false);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });
});
