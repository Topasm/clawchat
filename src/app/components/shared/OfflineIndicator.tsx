import { useEffect, useState } from 'react';
import { getOfflineQueueScope, offlineQueue } from '../../services/offlineQueue';
import { wsClient } from '../../services/wsClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { activeWorkspaceName } from '../../utils/workspaceLocation';
import useHomeReachable from '../../hooks/useHomeReachable';
import { translateUi } from '../../i18n';

/**
 * Home out of reach, as the design's state board says it: one soft red line
 * at the top -- what happened, what is kept on this device and when it goes
 * out -- and "Retry now". While queued changes are sent it says so instead.
 */
export default function OfflineIndicator() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const token = useAuthStore((state) => state.token);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const workspaceName = useWorkspaceStore(activeWorkspaceName);
  const queueScope = getOfflineQueueScope({ serverUrl, token });
  const [pendingCount, setPendingCount] = useState(() => offlineQueue.getCount(queueScope));
  const reachable = useHomeReachable();

  useEffect(() => {
    const recount = () => setPendingCount(offlineQueue.getCount(queueScope));
    recount();
    return offlineQueue.subscribe(recount);
  }, [queueScope]);

  // Only the socket can say Home answered: reconnect it, and the network hook
  // sends the kept changes once it is up.
  const retry = () => {
    if (serverUrl && token) wsClient.connect(serverUrl, token);
  };

  if (!reachable) {
    return (
      <div className="cc-offline-banner" role="status">
        <span className="cc-offline-banner__dot" aria-hidden="true" />
        <span className="cc-offline-banner__text">
          {translateUi("Can't reach {{workspace}}", { workspace: workspaceName })}
          {' · '}
          {pendingCount > 0
            ? translateUi('{{count}} changes are kept on this device and sent when it reconnects', {
                count: pendingCount,
              })
            : translateUi('Changes are kept on this device until it reconnects')}
        </span>
        <button type="button" className="cc-offline-banner__retry" onClick={retry}>
          {connectionStatus === 'reconnecting'
            ? translateUi('Reconnecting…')
            : translateUi('Retry now')}
        </button>
      </div>
    );
  }
  if (pendingCount > 0 && connectionStatus === 'connected') {
    return (
      <div className="cc-offline-banner cc-offline-banner--sending" role="status">
        <span className="cc-offline-banner__text">
          {translateUi('Sending {{count}} changes…', { count: pendingCount })}
        </span>
      </div>
    );
  }
  return null;
}
