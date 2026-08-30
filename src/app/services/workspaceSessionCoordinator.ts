import apiClient from './apiClient';
import { verifyClawChatHealth } from './workspaceHealth';
import {
  loadWorkspaceSession,
  removeWorkspaceSession,
  saveWorkspaceSession,
} from './workspaceCredentials';
import { useAuthStore } from '../stores/useAuthStore';
import { useHostSessionStore } from '../stores/useHostSessionStore';
import { useWorkspaceRuntimeStore } from '../stores/useWorkspaceRuntimeStore';
import {
  LOCAL_WORKSPACE_ID,
  normalizeWorkspaceUrl,
  useWorkspaceStore,
  type WorkspaceProfile,
} from '../stores/useWorkspaceStore';
import type { ServerConfigUpdate } from '../platform';

export interface ConnectRemoteWorkspaceInput {
  name: string;
  remoteUrl: string;
  pin: string;
  selectedProfileId: string | null;
}

export type SavedRemoteActivation =
  | { kind: 'connected'; profile: WorkspaceProfile }
  | {
      kind: 'needs-pin';
    };

interface AuthSessionSnapshot {
  token: string | null;
  refreshToken: string | null;
  serverUrl: string | null;
  hostId: string | null;
  hostPublicKey: string | null;
  relayUrl: string | null;
}

function captureAuthSession(): AuthSessionSnapshot {
  const auth = useAuthStore.getState();
  return {
    token: auth.token,
    refreshToken: auth.refreshToken,
    serverUrl: auth.serverUrl,
    hostId: auth.hostId,
    hostPublicKey: auth.hostPublicKey,
    relayUrl: auth.relayUrl,
  };
}

function restoreAuthSession(session: AuthSessionSnapshot): void {
  useAuthStore.setState({ ...session, isLoading: false });
}

function beginWorkspaceTransition(to: string, phase: 'preflight' | 'activating') {
  const workspace = useWorkspaceStore.getState();
  useWorkspaceRuntimeStore.getState().setWorkspaceTransition({
    kind: 'workspace',
    phase,
    from: workspace.activeWorkspaceId,
    to,
  });
}

function endWorkspaceTransition() {
  useWorkspaceRuntimeStore.getState().setWorkspaceTransition(null);
}

function markWorkspaceRollback(from: string, to: string) {
  useWorkspaceRuntimeStore.getState().setWorkspaceTransition({
    kind: 'workspace',
    phase: 'rolling_back',
    from,
    to,
  });
}

export function reconcileWorkspaceFromAuth(serverUrl: string | null): void {
  if (!serverUrl) return;
  const workspace = useWorkspaceStore.getState();
  if (workspace.activeWorkspaceId === LOCAL_WORKSPACE_ID) return;
  const normalizedServerUrl = serverUrl.toLowerCase();
  const existing = workspace.profiles.find(
    (profile) =>
      profile.kind === 'remote' && profile.serverUrl?.toLowerCase() === normalizedServerUrl,
  );
  if (existing) {
    workspace.setActiveWorkspace(existing.id);
    return;
  }

  let defaultName = 'Remote workspace';
  try {
    defaultName = new URL(serverUrl).hostname;
  } catch {
    // Keep a readable fallback for legacy stored URLs.
  }
  workspace.upsertRemote(defaultName, serverUrl);
}

export async function activateLocalWorkspace(): Promise<void> {
  const workspace = useWorkspaceStore.getState();
  if (
    workspace.activeWorkspaceId === LOCAL_WORKSPACE_ID &&
    useHostSessionStore.getState().phase === 'connected'
  ) {
    return;
  }

  beginWorkspaceTransition(LOCAL_WORKSPACE_ID, 'activating');
  const hostSession = useHostSessionStore.getState();
  try {
    // Preserve the remote credentials until the local handshake succeeds, so
    // a broken sidecar leaves the previously active remote session intact.
    hostSession.reset();
    const runtime = useWorkspaceRuntimeStore.getState();
    if (!runtime.config?.localServerEnabled) {
      await runtime.updateLocalServerPolicy({ localServerEnabled: true });
    }
    await useHostSessionStore.getState().retryHostStartup();
    const connectedHost = useHostSessionStore.getState();
    if (connectedHost.phase !== 'connected') {
      throw new Error(connectedHost.failure?.message || 'The local workspace could not be opened.');
    }
    useWorkspaceStore.getState().setActiveWorkspace(LOCAL_WORKSPACE_ID);
  } catch (error) {
    markWorkspaceRollback(LOCAL_WORKSPACE_ID, workspace.activeWorkspaceId);
    useHostSessionStore.getState().deactivate();
    throw error;
  } finally {
    endWorkspaceTransition();
  }
}

export async function connectRemoteWorkspace(
  input: ConnectRemoteWorkspaceInput,
): Promise<WorkspaceProfile> {
  const previousAuth = captureAuthSession();
  const previousWorkspace = useWorkspaceStore.getState();
  beginWorkspaceTransition(input.remoteUrl, 'preflight');
  try {
    const normalizedUrl = normalizeWorkspaceUrl(input.remoteUrl);
    const workspace = useWorkspaceStore.getState();
    const selectedProfile = workspace.profiles.find(
      (profile) => profile.id === input.selectedProfileId,
    );
    const health = await verifyClawChatHealth(normalizedUrl, selectedProfile?.hostId);
    const identity = await useAuthStore.getState().login(normalizedUrl, input.pin);
    if (identity.hostId && identity.hostId !== health.hostId) {
      throw new Error('The server identity changed between health check and sign-in.');
    }

    const profile = useWorkspaceStore
      .getState()
      .upsertRemote(input.name || identity.workspaceName || '', normalizedUrl, {
        hostId: health.hostId,
        hostPublicKey: identity.hostPublicKey ?? health.hostPublicKey,
        apiVersion: identity.apiVersion ?? health.apiVersion,
      });
    const auth = useAuthStore.getState();
    if (profile.credentialRef && auth.token && auth.serverUrl) {
      await saveWorkspaceSession(profile.credentialRef, {
        token: auth.token,
        refreshToken: auth.refreshToken,
        serverUrl: auth.serverUrl,
        hostId: auth.hostId,
        hostPublicKey: auth.hostPublicKey,
        relayUrl: auth.relayUrl,
      });
    }
    // Nothing after this point can reject, so the working local host session
    // remains intact until remote preflight and secure persistence both pass.
    useHostSessionStore.getState().deactivate();
    return profile;
  } catch (error) {
    markWorkspaceRollback(input.remoteUrl, previousWorkspace.activeWorkspaceId);
    restoreAuthSession(previousAuth);
    useWorkspaceStore.setState({
      profiles: previousWorkspace.profiles,
      activeWorkspaceId: previousWorkspace.activeWorkspaceId,
    });
    throw error;
  } finally {
    endWorkspaceTransition();
  }
}

export async function activateSavedRemoteWorkspace(
  profile: WorkspaceProfile,
): Promise<SavedRemoteActivation> {
  if (!profile.serverUrl || !profile.credentialRef) return { kind: 'needs-pin' };

  beginWorkspaceTransition(profile.id, 'preflight');
  const previousAuth = captureAuthSession();
  try {
    const [health, session] = await Promise.all([
      verifyClawChatHealth(profile.serverUrl, profile.hostId),
      loadWorkspaceSession(profile.credentialRef),
    ]);
    if (!session) return { kind: 'needs-pin' };
    if (session.hostId && session.hostId !== health.hostId) {
      throw new Error('The saved session belongs to a different ClawChat host.');
    }

    useAuthStore.setState({ ...session, isLoading: false });
    await apiClient.get('/capabilities');
    useHostSessionStore.getState().deactivate();
    useWorkspaceStore.getState().setActiveWorkspace(profile.id);
    return { kind: 'connected', profile };
  } catch (error) {
    markWorkspaceRollback(profile.id, useWorkspaceStore.getState().activeWorkspaceId);
    restoreAuthSession(previousAuth);
    throw error;
  } finally {
    endWorkspaceTransition();
  }
}

export async function removeRemoteWorkspace(profile: WorkspaceProfile): Promise<void> {
  if (profile.credentialRef) await removeWorkspaceSession(profile.credentialRef);
  useWorkspaceStore.getState().removeRemote(profile.id);
}

export async function updateLocalServerPolicyForSession(
  updates: ServerConfigUpdate,
): Promise<{ leftActiveLocalWorkspace: boolean }> {
  await useWorkspaceRuntimeStore.getState().updateLocalServerPolicy(updates);
  const leftActiveLocalWorkspace =
    updates.localServerEnabled === false &&
    useWorkspaceStore.getState().activeWorkspaceId === LOCAL_WORKSPACE_ID;
  if (leftActiveLocalWorkspace) {
    useHostSessionStore.getState().deactivate();
    useAuthStore.getState().logout();
  }
  return { leftActiveLocalWorkspace };
}

export async function retryLocalWorkspace(): Promise<void> {
  const runtime = useWorkspaceRuntimeStore.getState();
  await runtime.updateLocalServerPolicy({ localServerEnabled: true });
  useHostSessionStore.getState().reset();
  await useHostSessionStore.getState().retryHostStartup();
  await useWorkspaceRuntimeStore.getState().refresh();
}

export async function resetWorkspaceConnections(): Promise<void> {
  const credentials = useWorkspaceStore
    .getState()
    .profiles.flatMap((profile) => (profile.credentialRef ? [profile.credentialRef] : []));
  await Promise.all(credentials.map((credential) => removeWorkspaceSession(credential)));
  useHostSessionStore.getState().deactivate();
  useAuthStore.getState().logout();
  useWorkspaceStore.getState().reset();
}
