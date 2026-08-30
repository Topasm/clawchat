import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { platformApi } from '../../platform';
import {
  isWorkspaceSessionReady,
  resolveNativeSettingsRoute,
} from '../../services/nativeRoutePolicy';
import { useAuthStore } from '../../stores/useAuthStore';
import { useHostSessionStore } from '../../stores/useHostSessionStore';
import { useQuickCaptureStore } from '../../stores/useQuickCaptureStore';

/**
 * Native commands must remain available before authentication and while the
 * local server is recovering, so this bridge stays above AppRouter.
 */
export default function NativeCommandBridge() {
  const navigate = useNavigate();
  const token = useAuthStore((state) => state.token);
  const healthOK = useAuthStore((state) => state.healthOK);
  const hostPhase = useHostSessionStore((state) => state.phase);
  const openQuickCapture = useQuickCaptureStore((state) => state.open);

  const openSettings = useCallback(() => {
    navigate(resolveNativeSettingsRoute({ token, healthOK, hostPhase }));
  }, [healthOK, hostPhase, navigate, token]);

  useEffect(() => platformApi.events.on('navigate', navigate), [navigate]);

  useEffect(() => platformApi.events.on('open-settings', openSettings), [openSettings]);

  useEffect(() => {
    return platformApi.events.on('open-quick-capture', () => {
      if (isWorkspaceSessionReady({ token, healthOK, hostPhase })) openQuickCapture();
      else navigate('/connections');
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
