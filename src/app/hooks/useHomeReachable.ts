import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/useAuthStore';

/** A connection that drops for less than this is not an outage. */
export const OUTAGE_GRACE_MS = 4000;

/**
 * Whether Home can be reached, as the offline banner and the hand-off buttons
 * both read it. A socket that is still opening, or blinks while it
 * reconnects, still counts as reachable; the browser going offline does not.
 */
export default function useHomeReachable(): boolean {
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    const goOnline = () => setBrowserOnline(navigator.onLine);
    const goOffline = () => setBrowserOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const unreachable = !browserOnline || (!!serverUrl && connectionStatus !== 'connected');
  useEffect(() => {
    if (!unreachable) {
      setLost(false);
      return;
    }
    const timer = window.setTimeout(() => setLost(true), browserOnline ? OUTAGE_GRACE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [unreachable, browserOnline]);

  return !(unreachable && lost);
}
