import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimPairingSession, parsePairingQrPayload } from '../pairingClaim';
import { relayClient } from '../relayClient';

describe('pairingClaim', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('parses only complete ClawChat pairing payloads', () => {
    expect(
      parsePairingQrPayload({
        type: 'clawchat_pair',
        server_url: 'http://host.local:8000',
        code: '123456',
      }),
    ).toMatchObject({ code: '123456' });
    expect(parsePairingQrPayload({ type: 'clawchat_pair', code: '123456' })).toBeNull();
  });

  it('returns one complete session after a direct claim', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          device_token: 'device-token',
          api_base_url: 'https://host.example/',
          host_id: 'host-1',
          host_public_key: 'public-key',
          relay_url: 'https://relay.example',
        }),
      }),
    );

    await expect(
      claimPairingSession(
        {
          type: 'clawchat_pair',
          server_url: 'http://host.local:8000/',
          code: '123456',
          host_id: 'host-1',
          host_public_key: 'public-key',
        },
        { name: 'Desktop Client', type: 'web' },
      ),
    ).resolves.toEqual({
      token: 'device-token',
      serverUrl: 'https://host.example',
      hostId: 'host-1',
      hostPublicKey: 'public-key',
      relayUrl: 'https://relay.example',
    });
  });

  it('uses the relay when the direct host cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unreachable')));
    vi.spyOn(relayClient, 'isConfigured').mockReturnValue(true);
    vi.spyOn(relayClient, 'request').mockResolvedValue({
      status: 200,
      headers: {},
      data: {
        device_token: 'relay-token',
        host_id: 'host-1',
        host_public_key: 'public-key',
      },
    });

    const session = await claimPairingSession(
      {
        type: 'clawchat_pair',
        server_url: 'http://host.local:8000',
        code: '123456',
        host_id: 'host-1',
        host_public_key: 'public-key',
        relay_url: 'https://relay.example',
      },
      { name: 'Desktop Client', type: 'web' },
    );

    expect(session.relayUrl).toBe('https://relay.example');
    expect(session.token).toBe('relay-token');
    expect(relayClient.request).toHaveBeenCalledWith(
      expect.objectContaining({ relayUrl: 'https://relay.example' }),
      expect.objectContaining({ path: '/api/pairing/claim' }),
    );
  });
});
