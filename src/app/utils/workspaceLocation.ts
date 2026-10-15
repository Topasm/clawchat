import type { ServerConfig } from '../platform';
import { LOCAL_WORKSPACE_ID } from '../stores/useWorkspaceStore';

/**
 * The desktop serves its own workspace: host mode (or a local server kept
 * running for it) while the private workspace on this device is the one shown.
 * A window that is a client of another Home is not hosting, whatever its
 * local server happens to be doing.
 */
export function isLocalHostMode(
  config: Pick<ServerConfig, 'appMode' | 'localServerEnabled'> | null,
  activeWorkspaceId: string,
): boolean {
  if (!config || activeWorkspaceId !== LOCAL_WORKSPACE_ID) return false;
  return config.appMode === 'host' || config.localServerEnabled;
}

/**
 * Where the workspace this app shows lives, in the words the sidebar uses: a
 * host and port for a server, nothing for the private workspace on this device.
 */
export function workspaceAddressLabel(serverUrl: string | null | undefined): string | null {
  if (!serverUrl) return null;
  try {
    const url = new URL(serverUrl);
    return url.pathname && url.pathname !== '/'
      ? `${url.host}${url.pathname.replace(/\/+$/, '')}`
      : url.host;
  } catch {
    return serverUrl;
  }
}

export type ItemStorageLocation =
  | { kind: 'workspace'; workspaceName: string }
  /** Saved in this browser or app only, waiting to reach the workspace. */
  | { kind: 'pending'; workspaceName: string };

/**
 * A task created while the workspace was unreachable keeps its optimistic
 * `temp-` id until the queued create reaches the server and the list is
 * refetched. Everything else came from the workspace.
 */
export function itemStorageLocation(
  item: { id: string },
  workspaceName: string,
): ItemStorageLocation {
  return item.id.startsWith('temp-')
    ? { kind: 'pending', workspaceName }
    : { kind: 'workspace', workspaceName };
}
