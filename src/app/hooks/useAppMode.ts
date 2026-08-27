import { useState, useEffect, useCallback } from 'react';
import { platformApi, type AppMode } from '../platform';
import { IS_DESKTOP } from '../types/platform';

interface UseAppModeResult {
  /** Current app mode. null outside desktop runtimes (web/mobile are always clients). */
  appMode: AppMode | null;
  /** Whether a mode change is in progress. */
  loading: boolean;
  /** Switch mode. Only works in a desktop runtime. */
  setAppMode: (mode: AppMode) => Promise<void>;
  /** Convenience: true when the desktop runtime is hosting. */
  isHost: boolean;
  /** Convenience: true when not hosting (desktop client, web, or mobile). */
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
