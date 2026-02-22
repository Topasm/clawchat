import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../useAuthStore';

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
    // Reset store to initial state
    useAuthStore.setState({
      token: null,
      refreshToken: null,
      serverUrl: null,
      isLoading: false,
      connectionStatus: 'demo',
    });
  });

  it('starts with null auth values and demo connection status', () => {
    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.serverUrl).toBeNull();
    expect(state.connectionStatus).toBe('demo');
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

    await expect(
      useAuthStore.getState().login('http://localhost:3000', 'wrong'),
    ).rejects.toThrow('Invalid PIN');

    vi.restoreAllMocks();
  });

  it('logout clears auth state and resets connectionStatus to demo', async () => {
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
    expect(state.connectionStatus).toBe('demo');
  });

  it('setToken updates only the token', () => {
    useAuthStore.getState().setToken('new-token');
    expect(useAuthStore.getState().token).toBe('new-token');
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
