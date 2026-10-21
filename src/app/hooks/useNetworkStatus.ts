import { useEffect, useRef, useState } from 'react';
import { getOfflineQueueScope, offlineQueue } from '../services/offlineQueue';
import { useAuthStore } from '../stores/useAuthStore';
import { wsClient } from '../services/wsClient';
import { logger } from '../services/logger';

/**
 * Monitors online/offline status and flushes the offline queue once the
 * socket reconnects to Home.
 * Must be used inside a component that also renders `useDataSync` (e.g., Layout).
 * Accepts a `refresh` callback to pull fresh data after flushing.
 */
function useNetworkStatus(refresh: () => void) {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const token = useAuthStore((s) => s.token);
  const queueScope = getOfflineQueueScope({ serverUrl, token });
  const [isFlushing, setIsFlushing] = useState(false);
  const [pendingCount, setPendingCount] = useState(() => offlineQueue.getCount(queueScope));
  const setConnectionStatus = useAuthStore((s) => s.setConnectionStatus);
  const flushingRef = useRef(false);

  // Recount when the queue changes rather than polling, so an idle app never
  // wakes up just to read localStorage.
  useEffect(() => {
    const recount = () => setPendingCount(offlineQueue.getCount(queueScope));
    recount();
    return offlineQueue.subscribe(recount);
  }, [queueScope]);

  useEffect(() => {
    if (!serverUrl) return;

    // Kept changes go out once the socket says Home answered -- not on the
    // browser's word, which only means some network is back.
    const flush = async () => {
      if (flushingRef.current) return;
      flushingRef.current = true;
      setIsFlushing(true);
      try {
        // Dynamic import to avoid circular dependency
        const { default: apiClient } = await import('../services/apiClient');
        await offlineQueue.flush(queueScope, apiClient);
        setPendingCount(offlineQueue.getCount(queueScope));
        refresh();
      } catch (error) {
        logger.warn('Offline queue: could not send kept changes', error);
      } finally {
        flushingRef.current = false;
        setIsFlushing(false);
      }
    };

    const handleOnline = () => {
      logger.info('Network: back online');
      // Skip the socket's backoff; its status reports whether Home answers.
      if (token) wsClient.connect(serverUrl, token);
    };

    const handleOffline = () => {
      logger.info('Network: went offline');
      setConnectionStatus('disconnected');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    const unsubscribe = useAuthStore.subscribe((state, previous) => {
      if (state.connectionStatus === 'connected' && previous.connectionStatus !== 'connected') {
        void flush();
      }
    });

    // Set initial status based on navigator.onLine
    if (!navigator.onLine) {
      setConnectionStatus('disconnected');
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, [serverUrl, token, queueScope, setConnectionStatus, refresh]);

  return { isFlushing, pendingCount };
}

export default useNetworkStatus;
