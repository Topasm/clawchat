import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyClawChatHealth } from '../workspaceHealth';

afterEach(() => {
  vi.unstubAllGlobals();
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('verifyClawChatHealth', () => {
  it('accepts a compatible workspace with a stable identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          service: 'clawchat',
          status: 'degraded',
          version: '0.1.5',
          api_version: '1',
          host_id: 'claw_lab',
          host_public_key: 'public-key',
        }),
      ),
    );

    await expect(verifyClawChatHealth('https://lab.example/', 'claw_lab')).resolves.toEqual({
      service: 'clawchat',
      status: 'degraded',
      version: '0.1.5',
      apiVersion: '1',
      hostId: 'claw_lab',
      hostPublicKey: 'public-key',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://lab.example/api/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects an unrelated HTTP server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ status: 'ok' })));

    await expect(verifyClawChatHealth('http://localhost:8000')).rejects.toThrow(
      'not a ClawChat workspace',
    );
  });

  it('rejects a changed host identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          service: 'clawchat',
          status: 'ok',
          version: '0.1.5',
          api_version: '1',
          host_id: 'claw_new',
        }),
      ),
    );

    await expect(verifyClawChatHealth('https://lab.example', 'claw_saved')).rejects.toThrow(
      'Saved host: claw_saved; current host: claw_new',
    );
  });

  it('rejects incompatible API versions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          service: 'clawchat',
          status: 'ok',
          version: '9.0.0',
          api_version: '9',
          host_id: 'claw_future',
        }),
      ),
    );

    await expect(verifyClawChatHealth('https://future.example')).rejects.toThrow(
      'API version is not supported',
    );
  });
});
