import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { homeGraceLeft, isHomeReachableNow } from '../services/homeReachability';

/**
 * Whether Home can be reached, as the offline banner and the hand-off buttons
 * both read it. A socket that is still opening, or blinks while it
 * reconnects, still counts as reachable; the browser going offline does not.
 */
export default function useHomeReachable(): boolean {
  // Re-render on what the answer depends on: the socket, the server and the browser.
  const serverUrl = useAuthStore((state) => state.serverUrl);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  const [, setGraceEnded] = useState(0);

  useEffect(() => {
    const update = () => setBrowserOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const reachable = isHomeReachableNow();
  // Inside the grace period, look again the moment it runs out.
  const graceLeft = reachable ? homeGraceLeft() : 0;
  useEffect(() => {
    if (graceLeft <= 0) return;
    const timer = window.setTimeout(() => setGraceEnded((count) => count + 1), graceLeft);
    return () => window.clearTimeout(timer);
  }, [graceLeft, serverUrl, connectionStatus, browserOnline]);

  return reachable;
}
