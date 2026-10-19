import { useEffect, useState } from 'react';
import { getOfflineQueueScope, offlineQueue } from '../../services/offlineQueue';
import { wsClient } from '../../services/wsClient';
import { useAuthStore } from '../../stores/useAuthStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { activeWorkspaceName } from '../../utils/workspaceLocation';
import { translateUi } from '../../i18n';

/** A connection that drops for less than this is not worth a banner. */
const SHOW_AFTER_MS = 4000;

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
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(() => offlineQueue.getCount(queueScope));
  const [lost, setLost] = useState(false);

  useEffect(() => {
    const recount = () => setPendingCount(offlineQueue.getCount(queueScope));
    recount();
    const goOnline = () => setBrowserOnline(true);
    const goOffline = () => setBrowserOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const unsubscribe = offlineQueue.subscribe(recount);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      unsubscribe();
    };
  }, [queueScope]);

  // A socket that is still opening, or blinks, is not an outage.
  const unreachable = !browserOnline || (!!serverUrl && connectionStatus !== 'connected');
  useEffect(() => {
    if (!unreachable) {
      setLost(false);
      return;
    }
    const timer = window.setTimeout(() => setLost(true), browserOnline ? SHOW_AFTER_MS : 0);
    return () => window.clearTimeout(timer);
  }, [unreachable, browserOnline]);

  const retry = () => {
    if (serverUrl && token) wsClient.connect(serverUrl, token);
    // The network hook flushes the queue and refreshes on "online".
    window.dispatchEvent(new Event('online'));
  };

  if (lost) {
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
  if (pendingCount > 0 && !unreachable) {
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
