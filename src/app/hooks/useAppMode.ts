import { useState, useEffect, useCallback } from 'react';
import { platformApi, type AppMode } from '../platform';
import { IS_DESKTOP } from '../types/platform';

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
  const [loading, setLoading] = useState(IS_DESKTOP);

  useEffect(() => {
    if (!IS_DESKTOP) {
      setAppModeState(null);
      setLoading(false);
      return;
    }
    platformApi.server.getAppMode().then((mode) => {
      setAppModeState(mode);
      setLoading(false);
    });
  }, []);

  const setAppMode = useCallback(async (mode: AppMode) => {
    if (!IS_DESKTOP) return;
    setLoading(true);
    try {
      await platformApi.server.setAppMode(mode);
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
