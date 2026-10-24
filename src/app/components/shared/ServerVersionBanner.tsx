import { useAuthStore } from '../../stores/useAuthStore';
import { useServerHealthStore } from '../../stores/useServerHealthStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { activeWorkspaceName } from '../../utils/workspaceLocation';
import ServerVersionNotice from './ServerVersionNotice';

interface ServerVersionBannerProps {
  /** The build's own version; tests pass one. */
  appVersion?: string;
}

/**
 * One line across the top of the shell when this app and the Home server
 * are not the same release. Settings > Connection says the same, but a user
 * who never opens it would otherwise meet the mismatch as odd bugs.
 */
export default function ServerVersionBanner({ appVersion }: ServerVersionBannerProps) {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const token = useAuthStore((state) => state.token);
  const health = useServerHealthStore((state) =>
    state.serverUrl === serverUrl ? state.health : null,
  );
  const workspaceName = useWorkspaceStore(activeWorkspaceName);
  if (!token || !health) return null;
  return (
    <ServerVersionNotice
      serverVersion={health.version}
      serverName={workspaceName}
      appVersion={appVersion}
      className="cc-version-notice--banner"
      showLink
    />
  );
}
