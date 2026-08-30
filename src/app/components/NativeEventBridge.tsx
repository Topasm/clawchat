import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { platformApi } from '../platform';
import { useAuthStore } from '../stores/useAuthStore';
import { useHostSessionStore } from '../stores/useHostSessionStore';
import { useQuickCaptureStore } from '../stores/useQuickCaptureStore';
import { useWorkspaceRuntimeStore } from '../stores/useWorkspaceRuntimeStore';

/**
 * Native application commands must remain available before authentication and
 * while the local server is recovering. Keep this bridge above AppRouter so a
 * native Settings or diagnostics command can always reach a public route.
 */
export default function NativeEventBridge() {
  const navigate = useNavigate();
  const initializeRuntime = useWorkspaceRuntimeStore((state) => state.initialize);
  const token = useAuthStore((state) => state.token);
  const healthOK = useAuthStore((state) => state.healthOK);
  const hostPhase = useHostSessionStore((state) => state.phase);
  const openQuickCapture = useQuickCaptureStore((state) => state.open);

  const openSettings = useCallback(() => {
    const workspaceReady =
      Boolean(token) && healthOK && (hostPhase === 'idle' || hostPhase === 'connected');
    navigate(workspaceReady ? '/settings' : '/connections');
  }, [healthOK, hostPhase, navigate, token]);

  useEffect(() => {
    void initializeRuntime();
  }, [initializeRuntime]);

  useEffect(() => {
    return platformApi.events.on('navigate', (...args) => {
      const route = args.find((value): value is string => typeof value === 'string');
      if (route) navigate(route);
    });
  }, [navigate]);

  useEffect(() => platformApi.events.on('open-settings', openSettings), [openSettings]);

  useEffect(() => {
    return platformApi.events.on('open-quick-capture', () => {
      if (token && healthOK && (hostPhase === 'idle' || hostPhase === 'connected')) {
        openQuickCapture();
      } else navigate('/connections');
    });
  }, [healthOK, hostPhase, navigate, openQuickCapture, token]);

  useEffect(() => {
    const handleSettingsShortcut = (event: KeyboardEvent) => {
      if (event.key === ',' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        openSettings();
      }
    };
    window.addEventListener('keydown', handleSettingsShortcut);
    return () => window.removeEventListener('keydown', handleSettingsShortcut);
  }, [openSettings]);

  return null;
}
