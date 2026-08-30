import { secureStorage } from './platform';

export interface SavedWorkspaceSession {
  token: string;
  refreshToken: string | null;
  serverUrl: string;
  hostId: string | null;
  hostPublicKey: string | null;
  relayUrl: string | null;
}

function hashId(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function workspaceCredentialRef(workspaceId: string): string {
  return `workspace-session-${hashId(workspaceId)}`;
}

export async function saveWorkspaceSession(
  credentialRef: string,
  session: SavedWorkspaceSession,
): Promise<void> {
  await secureStorage.set(credentialRef, JSON.stringify(session));
}

export async function loadWorkspaceSession(
  credentialRef: string,
): Promise<SavedWorkspaceSession | null> {
  const serialized = await secureStorage.get(credentialRef);
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized) as Partial<SavedWorkspaceSession>;
    if (typeof value.token !== 'string' || typeof value.serverUrl !== 'string') return null;
    return {
      token: value.token,
      refreshToken: typeof value.refreshToken === 'string' ? value.refreshToken : null,
      serverUrl: value.serverUrl,
      hostId: typeof value.hostId === 'string' ? value.hostId : null,
      hostPublicKey: typeof value.hostPublicKey === 'string' ? value.hostPublicKey : null,
      relayUrl: typeof value.relayUrl === 'string' ? value.relayUrl : null,
    };
  } catch {
    return null;
  }
}

export async function removeWorkspaceSession(credentialRef: string): Promise<void> {
  await secureStorage.remove(credentialRef);
}
