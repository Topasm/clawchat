import { useState, useEffect } from 'react';
import { getOfflineQueueScope, offlineQueue } from '../../services/offlineQueue';
import { useAuthStore } from '../../stores/useAuthStore';
import { WifiOffIcon } from './Icons';

export default function OfflineIndicator() {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const token = useAuthStore((state) => state.token);
  const queueScope = getOfflineQueueScope({ serverUrl, token });
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(() => offlineQueue.getCount(queueScope));

  useEffect(() => {
    setPendingCount(offlineQueue.getCount(queueScope));
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    const interval = setInterval(() => {
      setPendingCount(offlineQueue.getCount(queueScope));
    }, 3000);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(interval);
    };
  }, [queueScope]);

  if (isOnline && pendingCount === 0) return null;

  return (
    <div
      className="cc-offline-indicator"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '6px 12px',
        backgroundColor: isOnline
          ? 'var(--cc-color-info, #3B82F6)'
          : 'var(--cc-color-warning, #F59E0B)',
        color: '#fff',
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {!isOnline && (
        <>
          <WifiOffIcon size={14} />
          Offline
        </>
      )}
      {pendingCount > 0 && (
        <span style={{ fontWeight: 400 }}>
          {isOnline ? 'Syncing' : ''} {pendingCount} pending change{pendingCount !== 1 ? 's' : ''}
          ...
        </span>
      )}
    </div>
  );
}
