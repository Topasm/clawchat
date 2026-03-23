import { useState, useEffect } from 'react';
import { offlineQueue } from '../../services/offlineQueue';

export default function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(() => offlineQueue.getCount());

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    const interval = setInterval(() => {
      setPendingCount(offlineQueue.getCount());
    }, 3000);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(interval);
    };
  }, []);

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
        backgroundColor: isOnline ? 'var(--cc-color-info, #3B82F6)' : 'var(--cc-color-warning, #F59E0B)',
        color: '#fff',
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {!isOnline && (
        <>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="1" y1="1" x2="15" y2="15" />
            <path d="M5 5a7 7 0 0 1 9 1.5" />
            <circle cx="8" cy="14" r="1" fill="currentColor" />
          </svg>
          Offline
        </>
      )}
      {pendingCount > 0 && (
        <span style={{ fontWeight: 400 }}>
          {isOnline ? 'Syncing' : ''} {pendingCount} pending change{pendingCount !== 1 ? 's' : ''}...
        </span>
      )}
    </div>
  );
}
