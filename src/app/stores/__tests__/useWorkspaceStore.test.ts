import { beforeEach, describe, expect, it } from 'vitest';
import { LOCAL_WORKSPACE_ID, normalizeWorkspaceUrl, useWorkspaceStore } from '../useWorkspaceStore';

beforeEach(() => {
  localStorage.clear();
  useWorkspaceStore.getState().reset();
});

describe('workspace connections', () => {
  it('always starts with the local Mac workspace', () => {
    const state = useWorkspaceStore.getState();

    expect(state.activeWorkspaceId).toBe(LOCAL_WORKSPACE_ID);
    expect(state.profiles).toEqual([
      expect.objectContaining({ id: LOCAL_WORKSPACE_ID, kind: 'local', serverUrl: null }),
    ]);
  });

  it('stores remote metadata without storing a PIN', () => {
    const profile = useWorkspaceStore.getState().upsertRemote('Home', 'https://home.example/');

    expect(profile).toMatchObject({
      kind: 'remote',
      name: 'Home',
      serverUrl: 'https://home.example',
    });
    expect(JSON.stringify(useWorkspaceStore.getState())).not.toContain('pin');
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(profile.id);
  });

  it('updates an existing URL instead of creating duplicate connections', () => {
    useWorkspaceStore.getState().upsertRemote('Old name', 'HTTPS://HOME.EXAMPLE/');
    useWorkspaceStore.getState().upsertRemote('Home', 'https://home.example');

    const remotes = useWorkspaceStore
      .getState()
      .profiles.filter((profile) => profile.kind === 'remote');
    expect(remotes).toHaveLength(1);
    expect(remotes[0].name).toBe('Home');
  });

  it('falls back to local when the active remote connection is removed', () => {
    const remote = useWorkspaceStore.getState().upsertRemote('Work', 'http://work.local:8000');

    useWorkspaceStore.getState().removeRemote(remote.id);

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(LOCAL_WORKSPACE_ID);
  });

  it('rejects unsafe or unsupported URLs', () => {
    expect(() => normalizeWorkspaceUrl('file:///tmp/clawchat')).toThrow(/HTTP or HTTPS/);
    expect(() => normalizeWorkspaceUrl('https://user:secret@example.com')).toThrow(/credentials/);
  });
});
