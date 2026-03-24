import { useState, useEffect, useCallback } from 'react';
import { IS_ELECTRON } from '../types/platform';
import type { AppMode } from '../types/electron';

interface UseAppModeResult {
  /** Current app mode. null if not Electron (web/mobile are always clients). */
  appMode: AppMode | null;
  /** Whether a mode change is in progress. */
  loading: boolean;
  /** Switch mode. Only works on Electron. */
  setAppMode: (mode: AppMode) => Promise<void>;
  /** Convenience: true when running as host on Electron. */
  isHost: boolean;
  /** Convenience: true when not host (client Electron, web, or mobile). */
  isClient: boolean;
}

export function useAppMode(): UseAppModeResult {
  const [appMode, setAppModeState] = useState<AppMode | null>(null);
  const [loading, setLoading] = useState(IS_ELECTRON);

  useEffect(() => {
    if (!IS_ELECTRON) {
      setAppModeState(null);
      setLoading(false);
      return;
    }
    window.electronAPI.server.getAppMode().then((mode) => {
      setAppModeState(mode);
      setLoading(false);
    });
  }, []);

  const setAppMode = useCallback(async (mode: AppMode) => {
    if (!IS_ELECTRON) return;
    setLoading(true);
    try {
      await window.electronAPI.server.setAppMode(mode);
      setAppModeState(mode);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    appMode,
    loading,
    setAppMode,
    isHost: appMode === 'host',
    isClient: appMode !== 'host',
  };
}
