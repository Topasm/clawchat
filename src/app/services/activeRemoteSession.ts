import type { SavedWorkspaceSession } from './workspaceCredentials';
import { removeWorkspaceSession, saveWorkspaceSession } from './workspaceCredentials';
import { logger } from './logger';
import { useAuthStore } from '../stores/useAuthStore';
import { useWorkspaceStore, type WorkspaceProfile } from '../stores/useWorkspaceStore';

interface AuthSessionSnapshot {
  token: string | null;
  refreshToken: string | null;
  serverUrl: string | null;
  hostId: string | null;
  hostPublicKey: string | null;
  relayUrl: string | null;
}

interface WorkspaceSnapshot {
  profiles: WorkspaceProfile[];
  activeWorkspaceId: string;
}

export interface PersistableRemoteSession {
  credentialRef: string;
  session: SavedWorkspaceSession;
}

function normalizeEndpoint(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase();
}

export function selectPersistableRemoteSession(
  auth: AuthSessionSnapshot,
  workspace: WorkspaceSnapshot,
): PersistableRemoteSession | null {
  if (!auth.token || !auth.serverUrl) return null;
  const profile = workspace.profiles.find(
    (candidate) => candidate.kind === 'remote' && candidate.id === workspace.activeWorkspaceId,
  );
  if (!profile?.credentialRef) return null;

  const activeEndpoint = normalizeEndpoint(auth.serverUrl);
  if (!profile.endpoints.some((endpoint) => normalizeEndpoint(endpoint.url) === activeEndpoint)) {
    return null;
  }

  return {
    credentialRef: profile.credentialRef,
    session: {
      token: auth.token,
      refreshToken: auth.refreshToken ?? null,
      serverUrl: auth.serverUrl,
      hostId: auth.hostId ?? null,
      hostPublicKey: auth.hostPublicKey ?? null,
      relayUrl: auth.relayUrl ?? null,
    },
  };
}

async function persistActiveRemoteSession(): Promise<void> {
  const selected = selectPersistableRemoteSession(
    useAuthStore.getState(),
    useWorkspaceStore.getState(),
  );
  if (!selected) return;
  await saveWorkspaceSession(selected.credentialRef, selected.session);
}

/** Remove the credential that makes the currently selected remote workspace PIN-less. */
export async function forgetActiveRemoteWorkspaceSession(): Promise<void> {
  const workspace = useWorkspaceStore.getState();
  const profile = workspace.profiles.find(
    (candidate) => candidate.kind === 'remote' && candidate.id === workspace.activeWorkspaceId,
  );
  if (profile?.credentialRef) await removeWorkspaceSession(profile.credentialRef);
}

export function startActiveRemoteSessionPersistence(): () => void {
  const persist = () => {
    void persistActiveRemoteSession().catch((error) => {
      logger.error('Could not persist the active remote workspace session', error);
    });
  };
  const stopAuth = useAuthStore.subscribe(persist);
  const stopWorkspace = useWorkspaceStore.subscribe(persist);
  persist();
  return () => {
    stopAuth();
    stopWorkspace();
  };
}
