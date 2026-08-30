import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './app/config/ThemeProvider';
import { queryClient } from './app/config/queryClient';
import { initializeQueryCachePersistence } from './app/config/queryCachePersistence';
import ErrorBoundary from './app/components/shared/ErrorBoundary';
import AppRouter from './router';
import { initializeUpdateLifecycle } from './app/services/updateLifecycle';
import { platformApi } from './app/platform';
import { useWorkspaceRuntimeStore } from './app/stores/useWorkspaceRuntimeStore';
import { useAuthStore } from './app/stores/useAuthStore';
import { useWorkspaceStore } from './app/stores/useWorkspaceStore';
import { saveWorkspaceSession } from './app/services/workspaceCredentials';

initializeQueryCachePersistence();

function AppRuntimeBridge() {
  const navigate = useNavigate();
  const initializeRuntime = useWorkspaceRuntimeStore((state) => state.initialize);

  useEffect(() => {
    void initializeRuntime();
  }, [initializeRuntime]);

  useEffect(() => {
    return platformApi.events.on('navigate', (...args) => {
      const route = args.find((value): value is string => typeof value === 'string');
      if (route) navigate(route);
    });
  }, [navigate]);

  useEffect(() => {
    const persistActiveRemoteSession = () => {
      const auth = useAuthStore.getState();
      const workspace = useWorkspaceStore.getState();
      const profile = workspace.profiles.find(
        (candidate) => candidate.kind === 'remote' && candidate.id === workspace.activeWorkspaceId,
      );
      if (!profile?.credentialRef || !auth.token || !auth.serverUrl) return;
      const endpointMatches = profile.endpoints.some(
        (endpoint) =>
          endpoint.url.replace(/\/+$/, '').toLowerCase() ===
          auth.serverUrl?.replace(/\/+$/, '').toLowerCase(),
      );
      if (!endpointMatches) return;
      void saveWorkspaceSession(profile.credentialRef, {
        token: auth.token,
        refreshToken: auth.refreshToken,
        serverUrl: auth.serverUrl,
        hostId: auth.hostId,
        hostPublicKey: auth.hostPublicKey,
        relayUrl: auth.relayUrl,
      });
    };
    const stopAuth = useAuthStore.subscribe(persistActiveRemoteSession);
    const stopWorkspace = useWorkspaceStore.subscribe(persistActiveRemoteSession);
    persistActiveRemoteSession();
    return () => {
      stopAuth();
      stopWorkspace();
    };
  }, []);

  useEffect(() => {
    const openConnections = (event: KeyboardEvent) => {
      if (event.key === ',' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        navigate('/connections');
      }
    };
    window.addEventListener('keydown', openConnections);
    return () => window.removeEventListener('keydown', openConnections);
  }, [navigate]);

  return null;
}

export default function App() {
  useEffect(() => {
    initializeUpdateLifecycle();
  }, []);

  return (
    <ErrorBoundary name="App">
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <BrowserRouter>
            <AppRuntimeBridge />
            <AppRouter />
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
