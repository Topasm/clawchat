export interface ClawChatHealth {
  service: 'clawchat';
  status: 'ok' | 'degraded';
  version: string;
  apiVersion: string;
  hostId: string;
  hostPublicKey: string | null;
}

interface RawHealth {
  service?: unknown;
  status?: unknown;
  version?: unknown;
  api_version?: unknown;
  host_id?: unknown;
  host_public_key?: unknown;
}

export async function verifyClawChatHealth(
  serverUrl: string,
  expectedHostId?: string | null,
): Promise<ClawChatHealth> {
  const url = serverUrl.replace(/\/+$/, '');
  const response = await fetch(`${url}/api/health`, {
    method: 'GET',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`Workspace health check failed with HTTP ${response.status}.`);
  }
  const data = (await response.json()) as RawHealth;
  if (data.service !== 'clawchat') {
    throw new Error('This address is not a ClawChat workspace.');
  }
  const apiVersion = String(data.api_version ?? '');
  if (apiVersion !== '1') {
    throw new Error(`This ClawChat API version is not supported (${apiVersion || 'missing'}).`);
  }
  if (typeof data.host_id !== 'string' || !data.host_id) {
    throw new Error('This ClawChat server does not expose a stable host identity.');
  }
  if (expectedHostId && data.host_id !== expectedHostId) {
    throw new Error(
      `The server identity changed. Saved host: ${expectedHostId}; current host: ${data.host_id}.`,
    );
  }
  return {
    service: 'clawchat',
    status: data.status === 'ok' ? 'ok' : 'degraded',
    version: typeof data.version === 'string' ? data.version : 'unknown',
    apiVersion,
    hostId: data.host_id,
    hostPublicKey: typeof data.host_public_key === 'string' ? data.host_public_key : null,
  };
}
