import { useCallback, useEffect } from 'react';
import type { AppMode } from '../platform';
import { IS_DESKTOP } from '../types/platform';
import { useWorkspaceRuntimeStore } from '../stores/useWorkspaceRuntimeStore';

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
  const appMode = useWorkspaceRuntimeStore((state) => state.config?.appMode ?? null);
  const loading = useWorkspaceRuntimeStore(
    (state) => state.bootstrapPhase === 'reading_config' || state.transition !== null,
  );
  const initialize = useWorkspaceRuntimeStore((state) => state.initialize);
  const setCompatibilityMode = useWorkspaceRuntimeStore((state) => state.setCompatibilityMode);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const setAppMode = useCallback(async (mode: AppMode) => {
    if (!IS_DESKTOP) return;
    await setCompatibilityMode(mode);
  }, [setCompatibilityMode]);

  return {
    appMode,
    loading,
    setAppMode,
    isHost: appMode === 'host',
    isClient: appMode !== 'host',
  };
}
