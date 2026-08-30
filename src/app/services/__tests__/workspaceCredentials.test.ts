import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadWorkspaceSession,
  removeWorkspaceSession,
  saveWorkspaceSession,
  workspaceCredentialRef,
} from '../workspaceCredentials';

beforeEach(() => {
  localStorage.clear();
});

describe('workspace credentials', () => {
  it('stores sessions outside workspace profile metadata', async () => {
    const credentialRef = workspaceCredentialRef('claw_lab');
    await saveWorkspaceSession(credentialRef, {
      token: 'access-token',
      refreshToken: 'refresh-token',
      serverUrl: 'https://lab.example',
      hostId: 'claw_lab',
      hostPublicKey: 'public-key',
      relayUrl: null,
    });

    await expect(loadWorkspaceSession(credentialRef)).resolves.toMatchObject({
      token: 'access-token',
      hostId: 'claw_lab',
    });
    await removeWorkspaceSession(credentialRef);
    await expect(loadWorkspaceSession(credentialRef)).resolves.toBeNull();
  });
});
