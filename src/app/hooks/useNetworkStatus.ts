import { useEffect, useRef, useState } from 'react';
import { offlineQueue } from '../services/offlineQueue';
import { useAuthStore } from '../stores/useAuthStore';
import { logger } from '../services/logger';

/**
 * Monitors online/offline status and flushes the offline queue on reconnect.
 * Must be used inside a component that also renders `useDataSync` (e.g., Layout).
 * Accepts a `refresh` callback to pull fresh data after flushing.
 */
export function useNetworkStatus(refresh: () => void) {
  const [isFlushing, setIsFlushing] = useState(false);
  const [pendingCount, setPendingCount] = useState(() => offlineQueue.getCount());
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const setConnectionStatus = useAuthStore((s) => s.setConnectionStatus);
  const flushingRef = useRef(false);

  // Update pending count periodically (cheap — reads localStorage)
  useEffect(() => {
    const interval = setInterval(() => {
      setPendingCount(offlineQueue.getCount());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!serverUrl) return;

    const handleOnline = async () => {
      logger.info('Network: back online');
      setConnectionStatus('reconnecting');

      if (flushingRef.current) return;
      flushingRef.current = true;
      setIsFlushing(true);

      try {
        // Dynamic import to avoid circular dependency
        const { default: apiClient } = await import('../services/apiClient');
        await offlineQueue.flush(apiClient);
        setPendingCount(offlineQueue.getCount());
        refresh();
        setConnectionStatus('connected');
      } catch {
        setConnectionStatus('disconnected');
      } finally {
        flushingRef.current = false;
        setIsFlushing(false);
      }
    };

    const handleOffline = () => {
      logger.info('Network: went offline');
      setConnectionStatus('disconnected');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Set initial status based on navigator.onLine
    if (!navigator.onLine) {
      setConnectionStatus('disconnected');
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [serverUrl, setConnectionStatus, refresh]);

  return { isFlushing, pendingCount };
}

export default useNetworkStatus;
