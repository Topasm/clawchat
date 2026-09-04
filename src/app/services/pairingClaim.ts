import { relayClient } from './relayClient';
import { normalizeWorkspaceUrl } from '../stores/useWorkspaceStore';

export interface PairingQrPayload {
  type: 'clawchat_pair';
  server_url: string;
  code: string;
  host_id?: string;
  host_public_key?: string;
  relay_url?: string;
}

interface PairingClaimResponse {
  device_token: string;
  api_base_url?: string;
  host_id?: string;
  host_public_key?: string;
  relay_url?: string;
}

export interface ClaimedPairingSession {
  token: string;
  serverUrl: string;
  hostId: string | null;
  hostPublicKey: string | null;
  relayUrl: string | null;
}

export function parsePairingQrPayload(value: unknown): PairingQrPayload | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Partial<PairingQrPayload>;
  if (
    payload.type !== 'clawchat_pair' ||
    typeof payload.server_url !== 'string' ||
    !payload.server_url.trim() ||
    typeof payload.code !== 'string' ||
    !payload.code.trim()
  ) {
    return null;
  }
  return {
    type: 'clawchat_pair',
    server_url: payload.server_url,
    code: payload.code,
    ...(typeof payload.host_id === 'string' ? { host_id: payload.host_id } : {}),
    ...(typeof payload.host_public_key === 'string'
      ? { host_public_key: payload.host_public_key }
      : {}),
    ...(typeof payload.relay_url === 'string' ? { relay_url: payload.relay_url } : {}),
  };
}

function parseClaimResponse(value: unknown): PairingClaimResponse {
  if (!value || typeof value !== 'object') throw new Error('Pairing returned an invalid response');
  const result = value as Partial<PairingClaimResponse>;
  if (typeof result.device_token !== 'string' || !result.device_token) {
    throw new Error('Pairing returned an invalid device token');
  }
  return result as PairingClaimResponse;
}

export async function claimPairingSession(
  payload: PairingQrPayload,
  device: { name: string; type: string },
): Promise<ClaimedPairingSession> {
  const pairUrl = normalizeWorkspaceUrl(payload.server_url);
  const claimBody = JSON.stringify({
    code: payload.code,
    device_name: device.name,
    device_type: device.type,
  });
  let result: PairingClaimResponse;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    let response: Response;
    try {
      response = await fetch(`${pairUrl}/api/pairing/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: claimBody,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        typeof error?.detail === 'string' ? error.detail : `Pairing failed (${response.status})`,
      );
    }
    result = parseClaimResponse(await response.json());
  } catch (directError) {
    const relayConfig = {
      relayUrl: payload.relay_url,
      hostId: payload.host_id,
      hostPublicKey: payload.host_public_key,
    };
    if (!relayClient.isConfigured(relayConfig)) throw directError;
    const relayResponse = await relayClient.request(relayConfig, {
      method: 'POST',
      path: '/api/pairing/claim',
      headers: { 'content-type': 'application/json' },
      body: claimBody,
    });
    if (relayResponse.status >= 400) {
      const data = relayResponse.data as { detail?: unknown } | null;
      throw new Error(
        typeof data?.detail === 'string' ? data.detail : 'Pairing failed through relay',
        {
          cause: directError,
        },
      );
    }
    result = parseClaimResponse(relayResponse.data);
  }

  if (payload.host_public_key && result.host_public_key !== payload.host_public_key) {
    throw new Error('Host identity did not match the scanned QR code');
  }
  if (payload.host_id && result.host_id !== payload.host_id) {
    throw new Error('Host ID did not match the scanned QR code');
  }

  return {
    token: result.device_token,
    serverUrl: normalizeWorkspaceUrl(result.api_base_url || pairUrl),
    hostId: result.host_id ?? payload.host_id ?? null,
    hostPublicKey: result.host_public_key ?? payload.host_public_key ?? null,
    relayUrl: result.relay_url ?? payload.relay_url ?? null,
  };
}
