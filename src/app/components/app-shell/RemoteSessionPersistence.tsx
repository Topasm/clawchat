import { useEffect } from 'react';

export default function RemoteSessionPersistence() {
  useEffect(() => {
    let disposed = false;
    let stopPersistence: (() => void) | undefined;

    void import('../../services/activeRemoteSession').then(
      ({ startActiveRemoteSessionPersistence }) => {
        if (disposed) return;
        stopPersistence = startActiveRemoteSessionPersistence();
      },
    );

    return () => {
      disposed = true;
      stopPersistence?.();
    };
  }, []);

  return null;
}
