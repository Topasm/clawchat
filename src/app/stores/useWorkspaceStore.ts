import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const LOCAL_WORKSPACE_ID = 'local';

export interface WorkspaceProfile {
  id: string;
  kind: 'local' | 'remote';
  name: string;
  serverUrl: string | null;
  lastConnectedAt: string | null;
}

interface WorkspaceState {
  profiles: WorkspaceProfile[];
  activeWorkspaceId: string;
  upsertRemote: (name: string, serverUrl: string) => WorkspaceProfile;
  removeRemote: (id: string) => void;
  setActiveWorkspace: (id: string) => void;
  reset: () => void;
}

const LOCAL_WORKSPACE: WorkspaceProfile = {
  id: LOCAL_WORKSPACE_ID,
  kind: 'local',
  name: 'This device',
  serverUrl: null,
  lastConnectedAt: null,
};

export function normalizeWorkspaceUrl(input: string): string {
  const value = input.trim().replace(/\/+$/, '');
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Remote workspace URLs must use HTTP or HTTPS.');
  }
  if (url.username || url.password) {
    throw new Error('Do not include credentials in a workspace URL.');
  }
  return value;
}

function remoteId(serverUrl: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < serverUrl.length; index += 1) {
    hash ^= serverUrl.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `remote-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function initialState() {
  return {
    profiles: [LOCAL_WORKSPACE],
    activeWorkspaceId: LOCAL_WORKSPACE_ID,
  };
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      ...initialState(),

      upsertRemote: (name, inputUrl) => {
        const serverUrl = normalizeWorkspaceUrl(inputUrl);
        const id = remoteId(serverUrl.toLowerCase());
        const existing = get().profiles.find(
          (profile) =>
            profile.kind === 'remote' &&
            profile.serverUrl?.toLowerCase() === serverUrl.toLowerCase(),
        );
        const profile: WorkspaceProfile = {
          id: existing?.id ?? id,
          kind: 'remote',
          name: name.trim() || new URL(serverUrl).hostname,
          serverUrl,
          lastConnectedAt: new Date().toISOString(),
        };
        set((state) => ({
          profiles: [
            LOCAL_WORKSPACE,
            ...state.profiles
              .filter((candidate) => candidate.kind === 'remote' && candidate.id !== profile.id)
              .concat(profile),
          ],
          activeWorkspaceId: profile.id,
        }));
        return profile;
      },

      removeRemote: (id) => {
        if (id === LOCAL_WORKSPACE_ID) return;
        set((state) => ({
          profiles: state.profiles.filter((profile) => profile.id !== id),
          activeWorkspaceId:
            state.activeWorkspaceId === id ? LOCAL_WORKSPACE_ID : state.activeWorkspaceId,
        }));
      },

      setActiveWorkspace: (id) => {
        if (!get().profiles.some((profile) => profile.id === id)) return;
        set({ activeWorkspaceId: id });
      },

      reset: () => set(initialState()),
    }),
    {
      name: 'workspace-connections',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const saved = persisted as Partial<WorkspaceState> | undefined;
        const remotes = Array.isArray(saved?.profiles)
          ? saved.profiles.filter(
              (profile): profile is WorkspaceProfile =>
                profile?.kind === 'remote' &&
                typeof profile.id === 'string' &&
                typeof profile.name === 'string' &&
                typeof profile.serverUrl === 'string',
            )
          : [];
        const profiles = [LOCAL_WORKSPACE, ...remotes];
        const activeWorkspaceId = profiles.some(
          (profile) => profile.id === saved?.activeWorkspaceId,
        )
          ? (saved?.activeWorkspaceId ?? LOCAL_WORKSPACE_ID)
          : LOCAL_WORKSPACE_ID;
        return { ...current, profiles, activeWorkspaceId };
      },
    },
  ),
);
