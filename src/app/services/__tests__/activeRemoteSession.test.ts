import { describe, expect, it } from 'vitest';
import { selectPersistableRemoteSession } from '../activeRemoteSession';
import type { WorkspaceProfile } from '../../stores/useWorkspaceStore';

const localProfile: WorkspaceProfile = {
  id: 'local',
  kind: 'local',
  name: 'This device',
  serverUrl: null,
  hostId: null,
  hostPublicKey: null,
  apiVersion: null,
  credentialRef: null,
  endpoints: [],
  lastConnectedAt: null,
};

const remoteProfile: WorkspaceProfile = {
  id: 'lab',
  kind: 'remote',
  name: 'Lab',
  serverUrl: 'https://lab.example',
  hostId: 'lab-host',
  hostPublicKey: 'public-key',
  apiVersion: '1',
  credentialRef: 'workspace-session-lab',
  endpoints: [{ url: 'https://lab.example/', kind: 'public' }],
  lastConnectedAt: null,
};

const auth = {
  token: 'session-token',
  refreshToken: 'refresh-token',
  serverUrl: 'https://LAB.example',
  hostId: 'lab-host',
  hostPublicKey: 'public-key',
  relayUrl: null,
};

describe('active remote session selection', () => {
  it('selects credentials only when the active profile owns the authenticated endpoint', () => {
    expect(
      selectPersistableRemoteSession(auth, {
        profiles: [localProfile, remoteProfile],
        activeWorkspaceId: remoteProfile.id,
      }),
    ).toEqual({
      credentialRef: 'workspace-session-lab',
      session: auth,
    });
  });

  it('does not save remote credentials under the local or a mismatched profile', () => {
    expect(
      selectPersistableRemoteSession(auth, {
        profiles: [localProfile, remoteProfile],
        activeWorkspaceId: localProfile.id,
      }),
    ).toBeNull();
    expect(
      selectPersistableRemoteSession(
        { ...auth, serverUrl: 'https://other.example' },
        { profiles: [localProfile, remoteProfile], activeWorkspaceId: remoteProfile.id },
      ),
    ).toBeNull();
  });
});
