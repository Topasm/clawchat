import { beforeEach, describe, expect, it, vi } from 'vitest';

const pairingMocks = vi.hoisted(() => ({ claimPairingSession: vi.fn() }));
const credentialMocks = vi.hoisted(() => ({
  saveWorkspaceSession: vi.fn(),
  loadWorkspaceSession: vi.fn(),
  removeWorkspaceSession: vi.fn(),
}));

vi.mock('../pairingClaim', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pairingClaim')>()),
  ...pairingMocks,
}));
vi.mock('../workspaceCredentials', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../workspaceCredentials')>()),
  ...credentialMocks,
}));

const { connectPairedWorkspace } = await import('../workspaceSessionCoordinator');
const { useAuthStore } = await import('../../stores/useAuthStore');
const { LOCAL_WORKSPACE_ID, useWorkspaceStore } = await import('../../stores/useWorkspaceStore');

const payload = {
  type: 'clawchat_pair' as const,
  server_url: 'https://home.example',
  code: '123456',
};
const device = { name: 'Desktop Client', type: 'web' };

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.getState().reset();
  useAuthStore.setState({ token: 'previous', serverUrl: 'http://localhost:8000' });
});

describe('connectPairedWorkspace', () => {
  it('adopts the claimed session and remembers the workspace', async () => {
    pairingMocks.claimPairingSession.mockResolvedValue({
      token: 'device-token',
      serverUrl: 'https://home.example',
      hostId: 'host-1',
      hostPublicKey: 'key',
      relayUrl: null,
    });

    const profile = await connectPairedWorkspace(payload, device);

    expect(pairingMocks.claimPairingSession).toHaveBeenCalledWith(payload, device);
    expect(useAuthStore.getState()).toMatchObject({
      token: 'device-token',
      refreshToken: null,
      serverUrl: 'https://home.example',
      hostId: 'host-1',
    });
    expect(profile).toMatchObject({ id: 'host-1', serverUrl: 'https://home.example' });
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('host-1');
    expect(credentialMocks.saveWorkspaceSession).toHaveBeenCalledWith(
      profile.credentialRef,
      expect.objectContaining({ token: 'device-token', serverUrl: 'https://home.example' }),
    );
  });

  it('keeps the previous session when the code is refused', async () => {
    pairingMocks.claimPairingSession.mockRejectedValue(new Error('Pairing code expired'));

    await expect(connectPairedWorkspace(payload, device)).rejects.toThrow('Pairing code expired');

    expect(useAuthStore.getState().token).toBe('previous');
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(LOCAL_WORKSPACE_ID);
    expect(useWorkspaceStore.getState().profiles).toHaveLength(1);
  });
});
