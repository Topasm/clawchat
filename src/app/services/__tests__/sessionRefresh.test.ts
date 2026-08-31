import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/useAuthStore';
import { refreshAuthSession } from '../sessionRefresh';

describe('refreshAuthSession', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({
      token: 'expired-access',
      refreshToken: 'remembered-refresh',
      serverUrl: 'https://workspace.example',
      hostId: null,
      hostPublicKey: null,
      relayUrl: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rotates and stores a remembered session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'fresh-access',
        refresh_token: 'fresh-refresh',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshAuthSession()).resolves.toBe('fresh-access');

    expect(fetchMock).toHaveBeenCalledWith('https://workspace.example/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: 'remembered-refresh' }),
    });
    expect(useAuthStore.getState()).toMatchObject({
      token: 'fresh-access',
      refreshToken: 'fresh-refresh',
    });
  });

  it('shares one rotation across simultaneous transport failures', async () => {
    let resolveRefresh!: (value: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const httpRefresh = refreshAuthSession();
    const websocketRefresh = refreshAuthSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveRefresh({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'shared-access',
        refresh_token: 'shared-refresh',
      }),
    } as Response);

    await expect(Promise.all([httpRefresh, websocketRefresh])).resolves.toEqual([
      'shared-access',
      'shared-access',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
